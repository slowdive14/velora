import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { base64ToUint8Array, decodeAudioData, float32ToInt16PCM, arrayBufferToBase64 } from '../utils/audioUtils';

interface LiveServiceConfig {
  apiKey: string;
  onAudioData: (buffer: AudioBuffer) => void;
  onTranscript: (text: string, isUser: boolean, isFinal: boolean) => void;
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
          4. subtly correct major grammatical errors or suggest more natural phrasing in your responses (e.g., "Oh, I see, you went to the store? That sounds fun!"),  and provide short segments for them to repeat to practice pronunciation.
          5. Keep your responses concise (under 15 seconds).
          6. Do not interrupt mid-sentence unless it's an enthusiastic agreement.
          7. Be friendly, supportive, and curious, acting as a supportive language partner.`;

      if (studyMaterial && studyMaterial.trim().length > 0) {
        systemInstruction = `You are a strict but helpful English tutor. 
        The user has provided the following study material:
        """
        ${studyMaterial}
        """
        
        Your goal is to check their understanding and help them practice speaking about this specific text.
        1. Start by asking them to summarize the text in their own words.
        2. Ask deep follow-up questions to test their comprehension and critical thinking about the material.
        3. Explicitly correct their grammar and pronunciation mistakes in a supportive way, and provide short segments for them to repeat to practice pronunciation.
        4. Keep the conversation focused on the study material.
        5. Keep your responses concise.
        6. When discussing topics with multiple sub-topics, ensure the user has sufficiently elaborated on a specific point before moving to the next.`;
      }

      this.session = await this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: systemInstruction,
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
            // If error occurs, mark as disconnected to prevent loops
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
      // If sending fails, do not trigger global onError to avoid loops, just log it
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
      // Fail silently for video frames to avoid spamming log
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
