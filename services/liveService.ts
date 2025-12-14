import { GoogleGenAI, LiveServerMessage, Modality, Tool, Type } from '@google/genai';
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
  onReconnecting?: () => void; // New callback for reconnection state
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

  constructor(config: LiveServiceConfig, audioContext: AudioContext) {
    this.config = config;
    this.ai = new GoogleGenAI({ apiKey: config.apiKey });
    this.audioContext = audioContext;
  }

  async connect(studyMaterial?: string) {
    // Store study material for reconnection
    this.lastStudyMaterial = studyMaterial || '';

    try {
      let systemInstruction = SYSTEM_INSTRUCTION;

      if (studyMaterial && studyMaterial.trim().length > 0) {
        systemInstruction = getStudyMaterialInstruction(studyMaterial);
      }

      const tools = TOOLS;

      const connectOptions: any = {
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: systemInstruction,
          tools: tools,
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
              silenceDurationMs: 400, // Reduced from 800ms for faster turn-taking
            }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          // Enable Context Window Compression for unlimited session duration
          // Enable Context Window Compression for unlimited session duration
          contextWindowCompression: {
            slidingWindow: {}
          },
          // Enable Session Resumption
          sessionResumption: {
            ...(this.resumptionToken ? { handle: this.resumptionToken } : {})
          }
        },

        callbacks: {
          onopen: () => {
            console.log('✅ Gemini Live Connected - Session ready');
            this.isConnected = true;
            this.isReconnecting = false;
            this.reconnectAttempts = 0; // Reset on successful connection
            if (this.reconnectTimeout) {
              clearTimeout(this.reconnectTimeout);
              this.reconnectTimeout = null;
            }
          },
          onmessage: this.handleMessage.bind(this),
          onclose: (event: any) => {
            console.log('Gemini Live Closed');
            if (event?.reason) {
              console.error('Close reason:', event.reason);
            }
            this.isConnected = false;

            // Attempt automatic reconnection if not intentionally disconnected
            // and we haven't exceeded max attempts
            if (!this.isReconnecting && this.reconnectAttempts < this.maxReconnectAttempts) {
              this.attemptReconnect();
            } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
              console.error('❌ Max reconnection attempts reached');
              this.config.onClose();
            } else {
              this.config.onClose();
            }
          },
          onerror: (err: ErrorEvent) => {
            console.error('❌ Gemini Live Error:', {
              message: err.message,
              error: err.error,
              type: err.type
            });
            this.isConnected = false;
            this.config.onError(new Error('Connection error: ' + (err.message || 'Unknown error')));
          },
        },
      };

      console.log('🔌 Connecting to Gemini Live...', {
        hasResumptionToken: !!this.resumptionToken,
        tokenPreview: this.resumptionToken ? this.resumptionToken.substring(0, 10) + '...' : 'none'
      });

      this.session = await this.ai.live.connect(connectOptions);
    } catch (error) {
      console.error('❌ Failed to connect to Gemini Live:', error);
      this.isConnected = false;
      this.config.onError(error as Error);
    }
  }

  private async handleMessage(message: LiveServerMessage) {
    // Debug: Log message keys to verify SessionResumptionUpdate
    // console.log('Rx:', Object.keys(message)); 

    // Handle GoAway Message (Server disconnect warning)
    if ((message as any).goAway) {
      console.warn('⚠️ GoAway Message Received:', (message as any).goAway);
    }

    // Handle Audio
    const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (audioData) {
      const uint8 = base64ToUint8Array(audioData);
      const buffer = await decodeAudioData(uint8, this.audioContext);
      this.config.onAudioData(buffer);
    }

    // Handle Transcripts
    const inputTranscript = message.serverContent?.inputTranscription;
    if (inputTranscript) {
      this.config.onTranscript(inputTranscript.text, true, !!message.serverContent?.turnComplete);
    }

    const outputTranscript = message.serverContent?.outputTranscription;
    const turnComplete = !!message.serverContent?.turnComplete;

    if (outputTranscript) {
      this.config.onTranscript(outputTranscript.text, false, turnComplete);
    } else if (turnComplete) {
      // CRITICAL: turnComplete without transcript means the turn ended
      // Send empty string to signal turn completion
      this.config.onTranscript("", false, true);
    }

    // Handle Session Resumption Update
    if ((message as any).sessionResumptionUpdate) {
      const update = (message as any).sessionResumptionUpdate;
      console.log('📦 Session Resumption Update Received:', update);

      if (update.newHandle) {
        this.resumptionToken = update.newHandle;
        console.log('📝 Token Saved (newHandle):', this.resumptionToken.substring(0, 20) + '...');
      } else if (update.sessionResumptionHandle) {
        this.resumptionToken = update.sessionResumptionHandle;
        console.log('📝 Token Saved (sessionResumptionHandle):', this.resumptionToken.substring(0, 20) + '...');
      } else if (update.handle) {
        this.resumptionToken = update.handle;
        console.log('📝 Token Saved (handle):', this.resumptionToken.substring(0, 20) + '...');
      } else {
        console.warn('⚠️ Session Resumption Update received but no handle found:', update);
      }
    }

    // Handle Tool Calls
    const toolCall = message.toolCall;
    if (toolCall) {
      toolCall.functionCalls.forEach(fc => {
        if (fc.name === 'reportCorrection') {
          const args = fc.args as any;
          if (args.original && args.corrected && args.explanation) {
            const correction: Correction = {
              original: args.original,
              corrected: args.corrected,
              explanation: args.explanation,
              timestamp: Date.now(),
              aiContext: "" // Leave empty so App.tsx can populate from transcript buffer
            };
            this.config.onCorrection(correction);

            // We must respond to the tool call to keep the session alive
            this.session.sendToolResponse({
              functionResponses: [
                {
                  id: fc.id,
                  name: fc.name,
                  response: { result: "OK" }
                }
              ]
            });
          }
        }
      });
    }
  }

  async sendAudioChunk(audioData: Float32Array) {
    if (!this.session || !this.isConnected) return;

    // Expects 16kHz PCM data. 
    const int16Buffer = float32ToInt16PCM(audioData);
    const base64 = arrayBufferToBase64(int16Buffer);

    try {
      await this.session.sendRealtimeInput({
        media: {
          mimeType: 'audio/pcm;rate=16000',
          data: base64,
        },
      });
    } catch (e) {
      console.error("Error sending audio", e);
    }
  }

  async sendVideoFrame(base64Image: string) {
    if (!this.session || !this.isConnected) return;
    try {
      await this.session.sendRealtimeInput({
        media: {
          mimeType: 'image/jpeg',
          data: base64Image,
        },
      });
    } catch (e) {
      // Fail silently
    }
  }

  async sendTextMessage(text: string) {
    if (!this.session || !this.isConnected) {
      console.warn("Cannot send text message: Session not connected");
      return;
    }
    console.log("Sending text message:", text);
    try {
      await this.session.sendRealtimeInput({
        text: text
      });
    } catch (e) {
      console.error("Error sending text message", e);
    }
  }

  private async attemptReconnect() {
    this.isReconnecting = true;
    this.reconnectAttempts++;

    // Exponential backoff: 2^n seconds (2s, 4s, 8s, 16s, 32s)
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 32000);

    console.log(`🔄 Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms...`);

    if (this.config.onReconnecting) {
      this.config.onReconnecting();
    }

    this.reconnectTimeout = window.setTimeout(async () => {
      try {
        console.log(this.resumptionToken ? '🔄 Resuming session with token...' : '🔄 Starting new session...');
        await this.connect(this.lastStudyMaterial);
        console.log('✅ Reconnection successful');
      } catch (error) {
        console.error('❌ Reconnection failed:', error);
        // onclose will be called again, which will trigger another attempt if under max
      }
    }, delay);
  }

  disconnect() {
    this.isConnected = false;
    this.isReconnecting = false; // Prevent reconnection when intentionally disconnecting

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.session) {
      try {
        this.session.close();
      } catch (e) {
        console.log("Error closing session", e);
      }
      this.session = null;
    }
  }
}
