export interface AudioConfig {
  sampleRate: number;
  channelCount: number;
}

export interface VideoState {
  isRecording: boolean;
  isConnected: boolean;
  isStreaming: boolean;
  videoUrl: string | null;
}

export interface Message {
  id: string;
  role: 'user' | 'ai';
  text: string;
  timestamp: number;
  // Indicates if the message is final or currently being streamed
  isFinal?: boolean;
  correction?: Correction;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface Correction {
  original: string;
  corrected: string;
  explanation: string;
  timestamp: number;
  aiContext?: string; // The AI's response text surrounding this correction
}