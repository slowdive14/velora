class PCMProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        // Buffer size: 2048 samples at 16kHz = 128ms
        // This is proven stable - don't change without thorough testing
        this.bufferSize = 2048;
        this.buffer = new Float32Array(this.bufferSize);
        this.index = 0;
        this.sampleRate = 16000;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input && input.length > 0) {
            const channel = input[0];

            if (globalThis.sampleRate !== this.sampleRate) {
                const downsampled = this.downsample(channel, globalThis.sampleRate, this.sampleRate);

                for (let i = 0; i < downsampled.length; i++) {
                    this.buffer[this.index++] = downsampled[i];
                    if (this.index >= this.bufferSize) {
                        this.port.postMessage(this.buffer.slice());
                        this.index = 0;
                    }
                }
            } else {
                for (let i = 0; i < channel.length; i++) {
                    this.buffer[this.index++] = channel[i];
                    if (this.index >= this.bufferSize) {
                        this.port.postMessage(this.buffer.slice());
                        this.index = 0;
                    }
                }
            }
        }
        return true;
    }

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

            result[i] = input[index1] + (input[index2] - input[index1]) * fraction;
        }
        return result;
    }
}

registerProcessor('pcm-processor', PCMProcessor);
