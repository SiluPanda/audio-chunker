import { WavInfo } from './types';

/**
 * Parse a WAV file buffer and extract header metadata.
 * Supports standard PCM WAV files (RIFF/WAVE format).
 *
 * @param buffer - Buffer containing WAV file data
 * @returns Parsed WAV file information
 * @throws Error if the buffer is not a valid WAV file
 */
export function parseWav(buffer: Buffer): WavInfo {
  if (buffer.length < 44) {
    throw new Error('Buffer too small to be a valid WAV file (minimum 44 bytes for header).');
  }

  // Check RIFF header
  const riff = buffer.toString('ascii', 0, 4);
  if (riff !== 'RIFF') {
    throw new Error(`Invalid WAV file: expected RIFF header, got "${riff}".`);
  }

  // Check WAVE format
  const wave = buffer.toString('ascii', 8, 12);
  if (wave !== 'WAVE') {
    throw new Error(`Invalid WAV file: expected WAVE format, got "${wave}".`);
  }

  // Find fmt and data chunks by iterating through subchunks
  let offset = 12;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let byteRate = 0;
  let blockAlign = 0;
  let bitDepth = 0;
  let dataOffset = 0;
  let dataSize = 0;
  let foundFmt = false;
  let foundData = false;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);

    if (chunkId === 'fmt ') {
      if (offset + 8 + chunkSize > buffer.length) {
        throw new Error('Invalid WAV file: fmt chunk extends beyond buffer.');
      }
      audioFormat = buffer.readUInt16LE(offset + 8);
      channels = buffer.readUInt16LE(offset + 10);
      sampleRate = buffer.readUInt32LE(offset + 12);
      byteRate = buffer.readUInt32LE(offset + 16);
      blockAlign = buffer.readUInt16LE(offset + 20);
      bitDepth = buffer.readUInt16LE(offset + 22);
      foundFmt = true;
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      foundData = true;
    }

    if (foundFmt && foundData) {
      break;
    }

    // Move to next chunk (chunks are word-aligned)
    offset += 8 + chunkSize;
    if (chunkSize % 2 !== 0) {
      offset += 1;
    }
  }

  if (!foundFmt) {
    throw new Error('Invalid WAV file: fmt chunk not found.');
  }

  if (!foundData) {
    throw new Error('Invalid WAV file: data chunk not found.');
  }

  if (audioFormat !== 1) {
    throw new Error(
      `Unsupported WAV format: audio format code ${audioFormat}. Only PCM (format 1) is supported.`,
    );
  }

  if (channels === 0 || sampleRate === 0 || bitDepth === 0) {
    throw new Error('Invalid WAV file: zero value in channels, sample rate, or bit depth.');
  }

  const totalSamples = dataSize / (channels * (bitDepth / 8));
  const durationMs = (totalSamples / sampleRate) * 1000;

  return {
    sampleRate,
    channels,
    bitDepth,
    dataOffset,
    dataSize,
    durationMs,
    audioFormat,
    blockAlign,
    byteRate,
  };
}

/**
 * Extract raw PCM samples from a WAV buffer as Float32Array (values in [-1.0, 1.0]).
 * Converts to mono by averaging channels if multi-channel.
 *
 * @param buffer - Buffer containing WAV file data
 * @param info - Parsed WAV info (from parseWav)
 * @returns Float32Array of mono PCM samples normalized to [-1.0, 1.0]
 */
export function extractPcmFloat32(buffer: Buffer, info: WavInfo): Float32Array {
  const { dataOffset, dataSize, channels, bitDepth } = info;
  const bytesPerSample = bitDepth / 8;
  const bytesPerFrame = channels * bytesPerSample;
  const totalFrames = Math.floor(dataSize / bytesPerFrame);

  // Clamp to actual available data
  const availableBytes = buffer.length - dataOffset;
  const framesAvailable = Math.floor(availableBytes / bytesPerFrame);
  const frameCount = Math.min(totalFrames, framesAvailable);

  const output = new Float32Array(frameCount);

  for (let i = 0; i < frameCount; i++) {
    let sum = 0;
    const frameOffset = dataOffset + i * bytesPerFrame;

    for (let ch = 0; ch < channels; ch++) {
      const sampleOffset = frameOffset + ch * bytesPerSample;

      if (bitDepth === 16) {
        const sample = buffer.readInt16LE(sampleOffset);
        sum += sample / 32768;
      } else if (bitDepth === 8) {
        // 8-bit WAV is unsigned
        const sample = buffer.readUInt8(sampleOffset);
        sum += (sample - 128) / 128;
      } else if (bitDepth === 24) {
        // Read 3 bytes as signed 24-bit integer
        const b0 = buffer[sampleOffset];
        const b1 = buffer[sampleOffset + 1];
        const b2 = buffer[sampleOffset + 2];
        let sample = (b2 << 16) | (b1 << 8) | b0;
        if (sample & 0x800000) {
          sample |= ~0xFFFFFF; // Sign extend
        }
        sum += sample / 8388608;
      } else if (bitDepth === 32) {
        const sample = buffer.readInt32LE(sampleOffset);
        sum += sample / 2147483648;
      }
    }

    output[i] = sum / channels;
  }

  return output;
}

/**
 * Resample PCM audio to a target sample rate using linear interpolation.
 *
 * @param samples - Input Float32Array of PCM samples
 * @param sourceSampleRate - Source sample rate in Hz
 * @param targetSampleRate - Target sample rate in Hz
 * @returns Resampled Float32Array
 */
export function resample(
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
): Float32Array {
  if (sourceSampleRate === targetSampleRate) {
    return samples;
  }

  const ratio = sourceSampleRate / targetSampleRate;
  const outputLength = Math.floor(samples.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, samples.length - 1);
    const frac = srcIndex - srcIndexFloor;

    output[i] = samples[srcIndexFloor] * (1 - frac) + samples[srcIndexCeil] * frac;
  }

  return output;
}

/**
 * Encode a Float32Array of mono PCM samples to a WAV buffer.
 *
 * @param samples - Float32Array of mono PCM samples in [-1.0, 1.0]
 * @param sampleRate - Sample rate in Hz
 * @param channels - Number of channels (default: 1)
 * @param bitDepth - Bits per sample (default: 16)
 * @returns Buffer containing the complete WAV file
 */
export function encodeWav(
  samples: Float32Array,
  sampleRate: number,
  channels: number = 1,
  bitDepth: number = 16,
): Buffer {
  if (bitDepth !== 16 && bitDepth !== 8) {
    throw new Error(`Unsupported bit depth for encoding: ${bitDepth}. Only 16-bit and 8-bit are supported.`);
  }

  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * channels * bytesPerSample;
  const headerSize = 44;
  const fileSize = headerSize + dataSize;

  const buffer = Buffer.alloc(fileSize);

  // RIFF header
  buffer.write('RIFF', 0, 4, 'ascii');
  buffer.writeUInt32LE(fileSize - 8, 4);
  buffer.write('WAVE', 8, 4, 'ascii');

  // fmt subchunk
  buffer.write('fmt ', 12, 4, 'ascii');
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitDepth, 34);

  // data subchunk
  buffer.write('data', 36, 4, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  // Write PCM data (duplicate mono samples across all channels)
  let writeOffset = headerSize;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));

    for (let ch = 0; ch < channels; ch++) {
      if (bitDepth === 16) {
        const intSample = Math.round(clamped * 32767);
        buffer.writeInt16LE(intSample, writeOffset);
        writeOffset += 2;
      } else {
        const intSample = Math.round((clamped + 1) * 127.5);
        buffer.writeUInt8(intSample, writeOffset);
        writeOffset += 1;
      }
    }
  }

  return buffer;
}

/**
 * Detect audio format from a buffer's magic bytes.
 *
 * @param buffer - Buffer containing audio data
 * @returns Detected format string or 'unknown'
 */
export function detectFormat(buffer: Buffer): string {
  if (buffer.length < 4) {
    return 'unknown';
  }

  // WAV: RIFF....WAVE
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer.length >= 12 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x41 &&
    buffer[10] === 0x56 &&
    buffer[11] === 0x45
  ) {
    return 'wav';
  }

  // MP3: ID3 tag or MPEG sync word
  if (
    (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) ||
    (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
  ) {
    return 'mp3';
  }

  // FLAC: fLaC
  if (buffer[0] === 0x66 && buffer[1] === 0x4c && buffer[2] === 0x61 && buffer[3] === 0x43) {
    return 'flac';
  }

  // OGG: OggS
  if (buffer[0] === 0x4f && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) {
    return 'ogg';
  }

  return 'unknown';
}
