import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { base64ToUint8Array, decodeAudioData, float32ToInt16PCM, arrayBufferToBase64 } from '../utils/audioUtils';
import { Correction } from '../types';
import { SYSTEM_INSTRUCTION, getStudyMaterialInstruction } from '../constants/prompts';
import { TOOLS } from '../constants/tools';

interface LiveServiceConfig {
  apiKey: string;
  onAudioData: (buffer: AudioBuffer) => void;
  onTranscript: (text: string, isUser: boolean, isFinal: boolean) => void;
  onCorrection: (correction: Correction) => void;
  onClose: () => void;
  onError: (error: Error) => void;
  onReconnecting?: () => void;
  onReconnected?: () => void;
}

export class LiveService {
  private ai: GoogleGenAI;
  private session: any = null;
  private config: LiveServiceConfig;
  private audioContext: AudioContext;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectTimeout: number | null = null;
  private isReconnecting: boolean = false;
  private lastStudyMaterial: string = '';
  private resumptionToken: string | null = null;
  private audioDecodeQueue: Promise<void> = Promise.resolve();
  private lastMessageTime: number = 0;
  private activityCheckInterval: number | null = null;
  private readonly ACTIVITY_TIMEOUT_MS = 15000; // 15초 무응답 시 재연결

  constructor(config: LiveServiceConfig, audioContext: AudioContext) {
    this.config = config;
    this.ai = new GoogleGenAI({ apiKey: config.apiKey });
    this.audioContext = audioContext;
  }

  async connect(studyMaterial?: string) {
    this.lastStudyMaterial = studyMaterial || '';

    try {
      let systemInstruction = SYSTEM_INSTRUCTION;

      if (studyMaterial && studyMaterial.trim().length > 0) {
        systemInstruction = getStudyMaterialInstruction(studyMaterial);
      }

      const connectOptions: any = {
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: systemInstruction,
          tools: TOOLS,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          generationConfig: {
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
            }
          },
          realtimeInputConfig: {
            automaticActivityDetection: {
              silenceDurationMs: 500,
            }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          contextWindowCompression: {
            slidingWindow: {}
          },
          sessionResumption: {
            ...(this.resumptionToken ? { handle: this.resumptionToken } : {})
          }
        },

        callbacks: {
          onopen: () => {
            console.log('✅ Gemini Live Connected');
            this.isConnected = true;
            this.isReconnecting = false;
            this.reconnectAttempts = 0;
            if (this.reconnectTimeout) {
              clearTimeout(this.reconnectTimeout);
              this.reconnectTimeout = null;
            }
            this.startActivityMonitor();
          },
          // CRITICAL: Use synchronous handler, process async work in background
          onmessage: (message: LiveServerMessage) => this.handleMessageSync(message),
          onclose: (event: any) => {
            const reason = event?.reason || '';
            console.log('Gemini Live Closed', reason);
            this.isConnected = false;
            this.stopActivityMonitor();

            // Don't reconnect for non-recoverable errors
            const nonRecoverable = /spending cap|quota|billing|unauthorized|api key|forbidden/i;
            if (nonRecoverable.test(reason)) {
              console.error('🚫 Non-recoverable error, stopping reconnection:', reason);
              this.config.onError(new Error(reason));
              this.config.onClose();
              return;
            }

            if (!this.isReconnecting && this.reconnectAttempts < this.maxReconnectAttempts) {
              this.attemptReconnect();
            } else {
              this.config.onClose();
            }
          },
          onerror: (err: ErrorEvent) => {
            console.error('❌ Gemini Live Error:', err.message || err);
            this.isConnected = false;
            this.config.onError(new Error(err.message || 'Connection error'));
          },
        },
      };

      console.log('🔌 Connecting to Gemini Live...');
      this.session = await this.ai.live.connect(connectOptions);
    } catch (error) {
      console.error('❌ Failed to connect:', error);
      this.isConnected = false;
      this.config.onError(error as Error);
    }
  }

  // CRITICAL: This must be SYNCHRONOUS - no await in the main path
  // All async work is fired off without blocking
  private handleMessageSync(message: LiveServerMessage): void {
    // Track activity for zombie connection detection
    this.lastMessageTime = Date.now();

    // Handle GoAway — server is about to close, reconnect proactively
    if ((message as any).goAway) {
      console.warn('⚠️ GoAway received — proactive reconnect');
      this.handleConnectionLost('goaway');
      return;
    }

    // Handle Audio - process ALL parts, not just the first one
    const parts = message.serverContent?.modelTurn?.parts;
    if (parts) {
      for (const part of parts) {
        const audioData = part?.inlineData?.data;
        if (audioData) {
          this.processAudioAsync(audioData);
        }
      }
    }

    // Handle Transcripts - synchronous, no await needed
    const inputTranscript = message.serverContent?.inputTranscription;
    if (inputTranscript) {
      this.config.onTranscript(inputTranscript.text, true, !!message.serverContent?.turnComplete);
    }

    const outputTranscript = message.serverContent?.outputTranscription;
    if (outputTranscript) {
      this.config.onTranscript(outputTranscript.text, false, !!message.serverContent?.turnComplete);
    }

    // Handle Session Resumption - synchronous
    if ((message as any).sessionResumptionUpdate) {
      const update = (message as any).sessionResumptionUpdate;
      const token = update.newHandle || update.sessionResumptionHandle || update.handle;
      if (token) {
        this.resumptionToken = token;
      }
    }

    // Handle Tool Calls - fire and forget, don't block
    const toolCall = message.toolCall;
    if (toolCall) {
      console.log('🔧 Tool call received:', JSON.stringify(toolCall).slice(0, 200));
      this.processToolCallAsync(toolCall);
    }
  }

  // Process audio decoding sequentially to preserve chunk order
  // Without this, concurrent decodeAudioData calls can finish out of order,
  // causing multiple onAudioData callbacks to fire simultaneously with the same
  // currentTime, which makes audio chunks overlap instead of playing sequentially
  private processAudioAsync(audioData: string): void {
    this.audioDecodeQueue = this.audioDecodeQueue.then(async () => {
      try {
        const uint8 = base64ToUint8Array(audioData);
        const buffer = await decodeAudioData(uint8, this.audioContext);
        this.config.onAudioData(buffer);
      } catch (e) {
        console.warn('⚠️ Audio decode/playback failed:', e);
      }
    });
  }

  // Process tool calls in background - CRITICAL for not freezing
  private async processToolCallAsync(toolCall: any): Promise<void> {
    const functionCalls = toolCall.functionCalls;
    if (!functionCalls || !Array.isArray(functionCalls)) {
      console.warn('⚠️ toolCall has no functionCalls array:', toolCall);
      return;
    }
    for (const fc of functionCalls) {
      console.log(`🔧 Processing: ${fc.name}`, fc.args);
      // Send tool response IMMEDIATELY - this is what unblocks the AI
      try {
        if (!this.session || !this.isConnected) break;
        this.session.sendToolResponse({
          functionResponses: [{
            id: fc.id,
            name: fc.name,
            response: { result: "OK" }
          }]
        });
      } catch (e) {
        console.warn('⚠️ Tool response failed');
        this.handleConnectionLost('tool_response_failed');
        return;
      }

      // Process correction data
      if (fc.name === 'reportCorrection') {
        const args = fc.args as any;
        if (args?.original && args?.corrected && args?.explanation) {
          const correction: Correction = {
            original: args.original,
            corrected: args.corrected,
            explanation: args.explanation,
            timestamp: Date.now(),
            aiContext: ""
          };
          console.log('📝 Firing onCorrection:', correction.original, '→', correction.corrected);
          this.config.onCorrection(correction);
        } else {
          console.warn('⚠️ reportCorrection missing required args:', args);
        }
      }
    }
  }

  sendAudioChunk(audioData: Float32Array): void {
    if (!this.session || !this.isConnected) return;

    try {
      const int16Buffer = float32ToInt16PCM(audioData);
      const base64 = arrayBufferToBase64(int16Buffer);
      this.session.sendRealtimeInput({
        media: {
          mimeType: 'audio/pcm;rate=16000',
          data: base64,
        },
      });
    } catch (e) {
      console.warn('⚠️ sendAudioChunk failed');
      this.handleConnectionLost('send_audio_failed');
    }
  }

  sendVideoFrame(base64Image: string): void {
    if (!this.session || !this.isConnected) return;

    try {
      this.session.sendRealtimeInput({
        media: {
          mimeType: 'image/jpeg',
          data: base64Image,
        },
      });
    } catch (e) {
      console.warn('⚠️ sendVideoFrame failed');
      this.handleConnectionLost('send_video_failed');
    }
  }

  sendTextMessage(text: string): boolean {
    if (!this.session || !this.isConnected) {
      return false;
    }

    try {
      this.session.sendRealtimeInput({ text });
      return true;
    } catch (e) {
      console.warn('⚠️ sendTextMessage failed');
      this.handleConnectionLost('send_text_failed');
      return false;
    }
  }

  private handleConnectionLost(reason: string) {
    if (this.isReconnecting) return;
    console.warn(`🔌 Connection lost: ${reason}`);
    this.isConnected = false;
    this.stopActivityMonitor();

    // Close existing session to clean up
    if (this.session) {
      try { this.session.close(); } catch (_) {}
      this.session = null;
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.attemptReconnect();
    } else {
      this.config.onClose();
    }
  }

  private startActivityMonitor() {
    this.stopActivityMonitor();
    this.lastMessageTime = Date.now();
    this.activityCheckInterval = window.setInterval(() => {
      if (!this.isConnected) return;
      const elapsed = Date.now() - this.lastMessageTime;
      if (elapsed > this.ACTIVITY_TIMEOUT_MS) {
        console.warn(`⚠️ No activity for ${elapsed}ms, triggering reconnect`);
        this.handleConnectionLost('activity_timeout');
      }
    }, 5000);
  }

  private stopActivityMonitor() {
    if (this.activityCheckInterval) {
      clearInterval(this.activityCheckInterval);
      this.activityCheckInterval = null;
    }
  }

  private attemptReconnect() {
    this.isReconnecting = true;
    this.reconnectAttempts++;

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 16000);
    console.log(`🔄 Reconnecting in ${delay}ms...`);

    if (this.config.onReconnecting) {
      this.config.onReconnecting();
    }

    // Reset audio decode queue to discard stale chunks from old session
    this.audioDecodeQueue = Promise.resolve();

    this.reconnectTimeout = window.setTimeout(async () => {
      try {
        await this.connect(this.lastStudyMaterial);

        if (this.isConnected) {
          // Notify App to reset audio scheduling state
          this.config.onReconnected?.();

          // Re-engage AI so user doesn't have to say "go on"
          // Small delay to let the session stabilize
          setTimeout(() => {
            this.sendTextMessage("Please continue where we left off.");
          }, 500);
        }
      } catch (error) {
        console.error('❌ Reconnection failed:', error);
      }
    }, delay);
  }

  disconnect() {
    this.isConnected = false;
    this.isReconnecting = false;
    this.stopActivityMonitor();
    // Prevent onclose from triggering unwanted reconnection after intentional disconnect
    this.reconnectAttempts = this.maxReconnectAttempts;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.session) {
      try {
        this.session.close();
      } catch (e) {
        // Ignore
      }
      this.session = null;
    }
  }

  getConnectionState() {
    return {
      connected: this.isConnected,
      reconnecting: this.isReconnecting
    };
  }
}
