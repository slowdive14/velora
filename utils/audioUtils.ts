export const AUDIO_SAMPLE_RATE = 24000;
export const INPUT_SAMPLE_RATE = 16000;

export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
): Promise<AudioBuffer> {
  const inputInt16 = new Int16Array(data.buffer);
  const float32 = new Float32Array(inputInt16.length);

  for (let i = 0; i < inputInt16.length; i++) {
    float32[i] = inputInt16[i] / 32768.0;
  }

  const audioBuffer = ctx.createBuffer(1, float32.length, AUDIO_SAMPLE_RATE);
  audioBuffer.copyToChannel(float32, 0);
  return audioBuffer;
}

/**
 * Converts Float32 audio data to Int16 PCM.
 * CRITICAL: Enforces Little Endian byte order for Gemini API compatibility.
 */
export function float32ToInt16PCM(float32: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    // Convert to 16-bit PCM
    const val = s < 0 ? s * 0x8000 : s * 0x7FFF;
    // Write as Little Endian
    view.setInt16(i * 2, val, true);
  }
  return buffer;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function downsampleTo16k(input: Float32Array, sourceSampleRate: number): Float32Array {
  if (sourceSampleRate === 16000) {
    return input;
  }

  const ratio = sourceSampleRate / 16000;
  const newLength = Math.round(input.length / ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const startOffset = Math.floor(i * ratio);
    const endOffset = Math.floor((i + 1) * ratio);
    let sum = 0;
    let count = 0;

    for (let j = startOffset; j < endOffset && j < input.length; j++) {
      sum += input[j];
      count++;
    }

    // Block averaging acts as a simple low-pass filter to prevent aliasing
    result[i] = count > 0 ? sum / count : 0;
  }

  return result;
}