/**
 * Test helpers for generating WAV audio data programmatically.
 */

/**
 * Create a WAV buffer with the given PCM samples.
 *
 * @param samples - Float32Array of mono PCM samples in [-1.0, 1.0]
 * @param sampleRate - Sample rate in Hz
 * @param channels - Number of channels (default: 1)
 * @param bitDepth - Bits per sample (default: 16)
 * @returns Buffer containing a valid WAV file
 */
export function createWavBuffer(
  samples: Float32Array,
  sampleRate: number,
  channels: number = 1,
  bitDepth: number = 16,
): Buffer {
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  // For multi-channel: repeat each sample across all channels
  const totalSamples = samples.length * channels;
  const dataSize = totalSamples * bytesPerSample;
  const headerSize = 44;
  const fileSize = headerSize + dataSize;

  const buffer = Buffer.alloc(fileSize);

  // RIFF header
  buffer.write('RIFF', 0, 4, 'ascii');
  buffer.writeUInt32LE(fileSize - 8, 4);
  buffer.write('WAVE', 8, 4, 'ascii');

  // fmt subchunk
  buffer.write('fmt ', 12, 4, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitDepth, 34);

  // data subchunk
  buffer.write('data', 36, 4, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  // Write PCM data
  let offset = headerSize;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    for (let ch = 0; ch < channels; ch++) {
      if (bitDepth === 16) {
        const intSample = Math.round(clamped * 32767);
        buffer.writeInt16LE(intSample, offset);
        offset += 2;
      } else if (bitDepth === 8) {
        const intSample = Math.round((clamped + 1) * 127.5);
        buffer.writeUInt8(intSample, offset);
        offset += 1;
      }
    }
  }

  return buffer;
}

/**
 * Generate silence (zero samples).
 *
 * @param durationMs - Duration in milliseconds
 * @param sampleRate - Sample rate in Hz
 * @returns Float32Array of zero samples
 */
export function generateSilence(durationMs: number, sampleRate: number): Float32Array {
  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  return new Float32Array(numSamples);
}

/**
 * Generate a sine wave tone.
 *
 * @param durationMs - Duration in milliseconds
 * @param sampleRate - Sample rate in Hz
 * @param frequency - Frequency in Hz (default: 440)
 * @param amplitude - Amplitude 0.0-1.0 (default: 0.5)
 * @returns Float32Array of PCM samples
 */
export function generateTone(
  durationMs: number,
  sampleRate: number,
  frequency: number = 440,
  amplitude: number = 0.5,
): Float32Array {
  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    samples[i] = amplitude * Math.sin(2 * Math.PI * frequency * i / sampleRate);
  }

  return samples;
}

/**
 * Generate white noise.
 *
 * @param durationMs - Duration in milliseconds
 * @param sampleRate - Sample rate in Hz
 * @param amplitude - Amplitude 0.0-1.0 (default: 0.3)
 * @returns Float32Array of random PCM samples
 */
export function generateNoise(
  durationMs: number,
  sampleRate: number,
  amplitude: number = 0.3,
): Float32Array {
  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    samples[i] = (Math.random() * 2 - 1) * amplitude;
  }

  return samples;
}

/**
 * Concatenate multiple Float32Arrays into one.
 */
export function concatSamples(...arrays: Float32Array[]): Float32Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Float32Array(totalLength);
  let offset = 0;

  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }

  return result;
}

/**
 * Create a WAV buffer with a pattern of speech and silence.
 * Speech is represented by a sine tone, silence by zeros.
 *
 * @param pattern - Array of { type: 'speech' | 'silence', durationMs: number }
 * @param sampleRate - Sample rate (default: 16000)
 * @returns WAV Buffer
 */
export function createPatternedWav(
  pattern: Array<{ type: 'speech' | 'silence'; durationMs: number }>,
  sampleRate: number = 16000,
): Buffer {
  const segments: Float32Array[] = [];

  for (const p of pattern) {
    if (p.type === 'speech') {
      segments.push(generateTone(p.durationMs, sampleRate, 440, 0.5));
    } else {
      segments.push(generateSilence(p.durationMs, sampleRate));
    }
  }

  const samples = concatSamples(...segments);
  return createWavBuffer(samples, sampleRate);
}
