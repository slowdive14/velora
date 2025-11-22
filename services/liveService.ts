import { GoogleGenAI, LiveServerMessage, Modality, Tool } from '@google/genai';
import { base64ToUint8Array, decodeAudioData, float32ToInt16PCM, arrayBufferToBase64 } from '../utils/audioUtils';
import { Correction } from '../types';

interface LiveServiceConfig {
  apiKey: string;
  onAudioData: (buffer: AudioBuffer) => void;
  onTranscript: (text: string, isUser: boolean, isFinal: boolean) => void;
  onCorrection: (correction: Correction) => void;
  onClose: () => void;
  onError: (error: Error) => void;
}

export class LiveService {
  private ai: GoogleGenAI;
  private session: any = null;
  private config: LiveServiceConfig;
  private audioContext: AudioContext;
  private isConnected: boolean = false;

  constructor(config: LiveServiceConfig, audioContext: AudioContext) {
    this.config = config;
    this.ai = new GoogleGenAI({ apiKey: config.apiKey });
    this.audioContext = audioContext;
  }

  async connect(studyMaterial?: string) {
    try {
      let systemInstruction = `You are a professional, charismatic, and helpful podcast co-host, but your secret mission is to help the user improve their English fluency. 
          The user is recording a video log. Your job is to:
          1. Listen attentively to the user's speech.
          2. If the user pauses for a while or seems stuck, jump in with a short, engaging question to keep the flow going.
          3. React naturally to interesting points they make.
          4. **CRITICAL INSTRUCTION**: You must act as a "Shadow Corrector".
             - When the user makes a grammar, vocabulary, or pronunciation mistake, you MUST:
               a) **Verbally**: Respond naturally, using the *correct* phrasing in your response (Implicit Recasting). Do NOT explicitly say "You made a mistake".
               b) **Function Call**: Call the 'reportCorrection' tool immediately.

          5. **Tool Use (Strictly Follow)**:
             If you detect ANY mistake, you MUST call the 'reportCorrection' tool with:
             - original: The user's incorrect phrase.
             - corrected: Your corrected version.
             - explanation: A brief 1-sentence reason.

          6. Keep your verbal responses concise (under 15 seconds).
          7. Be friendly, supportive, and curious.`;

      if (studyMaterial && studyMaterial.trim().length > 0) {
        systemInstruction = `You are a strict but helpful English tutor. 
        The user has provided the following study material:
        """
        ${studyMaterial}
        """
        
        Your goal is to check their understanding and help them practice speaking about this specific text.
        1. Start by asking them to summarize the text in their own words.
        2. Ask deep follow-up questions to test their comprehension and critical thinking about the material.
        3. Explicitly correct their grammar and pronunciation mistakes using the 'reportCorrection' tool.
        4. Keep the conversation focused on the study material.
        5. Keep your responses concise.`;
      }

      const tools: Tool[] = [
        {
          functionDeclarations: [
            {
              name: "reportCorrection",
              description: "Report a grammar, vocabulary, or pronunciation mistake made by the user.",
              parameters: {
                type: "OBJECT",
                properties: {
                  original: { type: "STRING", description: "The user's original incorrect phrase" },
                  corrected: { type: "STRING", description: "The corrected version of the phrase" },
                  explanation: { type: "STRING", description: "A brief explanation of the error" }
                },
                required: ["original", "corrected", "explanation"]
              }
            }
          ]
        }
      ];

      this.session = await this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: systemInstruction,
          tools: tools,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            console.log('Gemini Live Connected');
            this.isConnected = true;
          },
          onmessage: this.handleMessage.bind(this),
          onclose: () => {
            console.log('Gemini Live Closed');
            this.isConnected = false;
            this.config.onClose();
          },
          onerror: (err: ErrorEvent) => {
            console.error('Gemini Live Error', err);
            this.isConnected = false;
            this.config.onError(new Error('Connection error'));
          },
        },
      });
    } catch (error) {
      this.isConnected = false;
      this.config.onError(error as Error);
    }
  }

  private async handleMessage(message: LiveServerMessage) {
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
    if (outputTranscript) {
      this.config.onTranscript(outputTranscript.text, false, !!message.serverContent?.turnComplete);
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
              aiContext: "Correction reported via tool" // Placeholder, context is hard to get here
            };
            this.config.onCorrection(correction);

            // We must respond to the tool call to keep the session alive
            this.session.sendToolResponse({
              functionResponses: [
                {
                  id: fc.id,
                  name: fc.name,
                  response: { result: "Correction logged successfully" }
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

  disconnect() {
    this.isConnected = false;
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
