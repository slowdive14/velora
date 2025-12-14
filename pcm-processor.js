class PCMProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        // Reduced buffer for lower latency (was 4096 = ~256ms at 16kHz)
        // 2048 samples = ~128ms at 16kHz - good balance between latency and stability
        this.bufferSize = 2048;
        this.buffer = new Float32Array(this.bufferSize);
        this.index = 0;
        this.sampleRate = 16000; // Target sample rate
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input && input.length > 0) {
            const channel = input[0];

            // Check if we need to downsample
            // Note: globalThis.sampleRate is the context's sample rate
            if (globalThis.sampleRate !== this.sampleRate) {
                // Downsample input chunk
                const downsampled = this.downsample(channel, globalThis.sampleRate, this.sampleRate);

                // Fill buffer with downsampled data
                for (let i = 0; i < downsampled.length; i++) {
                    this.buffer[this.index++] = downsampled[i];
                    if (this.index >= this.bufferSize) {
                        this.port.postMessage(this.buffer);
                        this.index = 0;
                    }
                }
            } else {
                // No downsampling needed
                for (let i = 0; i < channel.length; i++) {
                    this.buffer[this.index++] = channel[i];
                    if (this.index >= this.bufferSize) {
                        this.port.postMessage(this.buffer);
                        this.index = 0;
                    }
                }
            }
        }
        return true;
    }

    // Linear Interpolation Downsampling
    downsample(input, sourceRate, targetRate) {
        if (sourceRate === targetRate) return input;

        const ratio = sourceRate / targetRate;
        const newLength = Math.ceil(input.length / ratio);
        const result = new Float32Array(newLength);

        for (let i = 0; i < newLength; i++) {
            const originalIndex = i * ratio;
            const index1 = Math.floor(originalIndex);
            const index2 = Math.min(index1 + 1, input.length - 1);
            const fraction = originalIndex - index1;

            const value1 = input[index1];
            const value2 = input[index2];
            result[i] = value1 + (value2 - value1) * fraction;
        }
        return result;
    }
}

registerProcessor('pcm-processor', PCMProcessor);
