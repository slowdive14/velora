import { GoogleGenAI, LiveServerMessage, Modality, Tool, Type } from '@google/genai';
import { base64ToUint8Array, decodeAudioData, float32ToInt16PCM, arrayBufferToBase64 } from '../utils/audioUtils';
import { Correction } from '../types';

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
      let systemInstruction = `You are a warm, engaging, and curious conversation partner helping the user practice English naturally.

          **Your Primary Goals**:
          1. **Keep them talking** - Your job is to make the user speak as much as possible
          2. **Be genuinely interested** - Ask follow-up questions, show curiosity about their life
          3. **Make it enjoyable** - This should feel like chatting with a friend, not a test

          **Conversation Strategy**:
          1. Listen attentively to what the user says
          2. Respond naturally to their points (1-2 sentences max)
          3. Ask engaging follow-up questions:
             - "That sounds interesting! Can you tell me more?"
             - "How did that make you feel?"
             - "Why do you think that happened?"
             - "Have you always felt that way?"
          4. Connect to their experiences and emotions
          5. If they pause or seem stuck, gently encourage: "Take your time" or ask a new question

          **Correction Philosophy - "B1→B2 Growth Partner"**:
          - **Target User**: Intermediate (B1) learner aiming for Upper-Intermediate (B2)
          - **Priority**: Build confidence while gently pushing toward B2 accuracy
          - **When to correct**:
            ✓ Clear grammatical errors that prevent B2 proficiency
            ✓ Incorrect verb tenses (key for B2 level)
            ✓ Subject-verb agreement errors
            ✓ Wrong word choice that changes meaning
            ✓ Missing essential grammatical elements (be verbs, auxiliary verbs)
            ✓ Unnatural collocations or expressions
          - **How to correct**:
            a) Verbally: Use the correct form naturally in your response (Implicit Recasting)
            b) Silently: Call 'reportCorrection' tool (but DON'T mention it verbally)
          - **When NOT to correct**:
            ✗ Minor article errors (a/an/the) if meaning is clear
            ✗ Preposition mistakes if understandable
            ✗ Minor pronunciation variations
            ✗ Acceptable informal/casual expressions
            ✗ Word order variations that are still grammatical

          **Examples TO CORRECT** (B1→B2 growth areas):
          - "I go to school yesterday" → "I went to school yesterday" (tense accuracy crucial for B2)
          - "He don't like it" → "He doesn't like it" (subject-verb agreement)
          - "I very happy" → "I am very happy" (missing essential verb)
          - "I am boring" (meant bored) → "I am bored" (wrong adjective form)
          - "I have seen him yesterday" → "I saw him yesterday" (tense choice)

          **Examples NOT to correct** (acceptable at B1→B2 transition):
          - "I went to the school" (extra article but clear)
          - "I am interesting in music" (should be 'interested' - correct this mildly)
          - Minor preposition choices like "in Monday" vs "on Monday" (correct but not critical)

          **Tone**: Friendly, warm, supportive, curious
          **Response length**: Keep it SHORT (1-2 sentences) so they can keep talking
          **Responsiveness**: ALWAYS respond to the user. If you didn't hear clearly or they stopped speaking, ask a gentle follow-up question. NEVER remain silent.
          **Remember**: The more THEY speak, the better!`;

      if (studyMaterial && studyMaterial.trim().length > 0) {
        systemInstruction = `You are a friendly and encouraging English conversation partner specializing in study material learning and discussion.

        The user has provided the following study material:
        """
        ${studyMaterial}
        """

        **Your Primary Goal**: Help the user LEARN this material AND SPEAK AS MUCH AS POSSIBLE in English.

        **Step 1 - First Contact**:
        - Start by warmly asking: "Hi! I see you have some study material. Have you read it yet?"
        - Wait for their response

        **If they say YES (already read)**:
        1. Great! Ask them: "What did you find most interesting or surprising about this material?"
        2. Let them speak freely. Your job is to:
           - Listen actively and respond naturally
           - Ask follow-up questions to keep them talking (e.g., "Can you tell me more about that?", "Why do you think that is?")
           - Connect to their personal experiences (e.g., "Have you experienced something similar?", "How would you apply this?")
           - Encourage elaboration (e.g., "That's interesting! Can you explain that in more detail?")
        3. Correction: Fix tense errors, subject-verb agreement, missing verbs (B1→B2 focus areas)
        4. Keep your responses SHORT (1-2 sentences) to maximize their speaking time
        5. Stay on the material's topic but allow natural tangents if they're speaking confidently

        **If they say NO (haven't read yet)**:
        1. Say: "No problem! Let me help you learn this material. Would you like me to:
           - Summarize the key points for you?
           - Walk through it section by section together?
           - Or would you prefer to read it first and then discuss?"
        2. **If they want help learning**:
           - Break down the material into digestible chunks
           - Explain key concepts clearly and simply (2-3 sentences per concept)
           - After each explanation, ask: "Does this make sense? Can you try explaining this back to me in your own words?"
           - Encourage them to speak and paraphrase what they learned
           - If they struggle, provide hints or rephrase, but always get them to speak
        3. **If they want to read first**:
           - Say: "Sure! Take your time. Let me know when you're ready to discuss."
           - When ready, proceed with the "YES" flow above

        **Throughout the conversation**:
        - Your goal is 70% them speaking, 30% you speaking
        - If teaching/explaining, keep it brief and immediately get them to speak
        - Ask open-ended questions that require detailed answers
        - Show genuine curiosity about their understanding and thoughts
        - Praise their effort and ideas to build confidence
        - Correct tense errors, subject-verb agreement, missing verbs to help reach B2 level

        **Remember**: You're not just discussing the material - you're helping them LEARN it while practicing English!`;
      }

      const tools: Tool[] = [
        {
          functionDeclarations: [
            {
              name: "reportCorrection",
              description: "Report a CLEAR grammar, vocabulary, or pronunciation mistake made by the user. Only use when there is an objective error, not for stylistic preferences.",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  original: { type: Type.STRING, description: "The user's original incorrect phrase" },
                  corrected: { type: Type.STRING, description: "The corrected version of the phrase" },
                  explanation: { type: Type.STRING, description: "A brief explanation of why this is an error (grammar rule, vocabulary misuse, etc.)" }
                },
                required: ["original", "corrected", "explanation"]
              }
            }
          ]
        }
      ];

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
              silenceDurationMs: 800,
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
      console.log("Tool Call Received:", toolCall);
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
