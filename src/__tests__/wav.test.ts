import { describe, it, expect } from 'vitest';
import { parseWav, extractPcmFloat32, resample, encodeWav, detectFormat } from '../wav';
import { createWavBuffer, generateTone, generateSilence } from './helpers';

describe('parseWav', () => {
  it('should parse a valid 16-bit mono WAV header', () => {
    const samples = generateTone(100, 16000);
    const wav = createWavBuffer(samples, 16000, 1, 16);
    const info = parseWav(wav);

    expect(info.sampleRate).toBe(16000);
    expect(info.channels).toBe(1);
    expect(info.bitDepth).toBe(16);
    expect(info.audioFormat).toBe(1);
    expect(info.dataOffset).toBe(44);
    expect(info.blockAlign).toBe(2);
    expect(info.byteRate).toBe(32000);
  });

  it('should parse a stereo WAV header', () => {
    const samples = generateTone(100, 44100);
    const wav = createWavBuffer(samples, 44100, 2, 16);
    const info = parseWav(wav);

    expect(info.sampleRate).toBe(44100);
    expect(info.channels).toBe(2);
    expect(info.bitDepth).toBe(16);
    expect(info.blockAlign).toBe(4);
  });

  it('should parse an 8-bit WAV header', () => {
    const samples = generateTone(100, 16000);
    const wav = createWavBuffer(samples, 16000, 1, 8);
    const info = parseWav(wav);

    expect(info.bitDepth).toBe(8);
    expect(info.blockAlign).toBe(1);
  });

  it('should calculate duration correctly', () => {
    const samples = generateTone(1000, 16000); // 1 second
    const wav = createWavBuffer(samples, 16000, 1, 16);
    const info = parseWav(wav);

    expect(info.durationMs).toBeCloseTo(1000, 0);
  });

  it('should calculate duration for short audio', () => {
    const samples = generateTone(50, 16000); // 50ms
    const wav = createWavBuffer(samples, 16000, 1, 16);
    const info = parseWav(wav);

    expect(info.durationMs).toBeCloseTo(50, 0);
  });

  it('should calculate data size correctly', () => {
    const samples = generateTone(100, 16000);
    const wav = createWavBuffer(samples, 16000, 1, 16);
    const info = parseWav(wav);

    expect(info.dataSize).toBe(samples.length * 2); // 16-bit = 2 bytes per sample
  });

  it('should throw for buffer too small', () => {
    const buf = Buffer.alloc(10);
    expect(() => parseWav(buf)).toThrow('Buffer too small');
  });

  it('should throw for invalid RIFF header', () => {
    const buf = Buffer.alloc(44);
    buf.write('XXXX', 0);
    expect(() => parseWav(buf)).toThrow('expected RIFF header');
  });

  it('should throw for invalid WAVE format', () => {
    const buf = Buffer.alloc(44);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36, 4);
    buf.write('XXXX', 8);
    expect(() => parseWav(buf)).toThrow('expected WAVE format');
  });

  it('should throw for missing fmt chunk', () => {
    const buf = Buffer.alloc(44);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36, 4);
    buf.write('WAVE', 8);
    // Write a non-fmt chunk
    buf.write('JUNK', 12);
    buf.writeUInt32LE(0, 16);
    expect(() => parseWav(buf)).toThrow('fmt chunk not found');
  });

  it('should throw for non-PCM format', () => {
    const samples = generateTone(100, 16000);
    const wav = createWavBuffer(samples, 16000, 1, 16);
    // Change audio format from 1 (PCM) to 3 (float)
    wav.writeUInt16LE(3, 20);
    expect(() => parseWav(wav)).toThrow('Only PCM');
  });
});

describe('extractPcmFloat32', () => {
  it('should extract mono 16-bit samples as float32', () => {
    const original = new Float32Array([0, 0.5, -0.5, 1.0, -1.0]);
    const wav = createWavBuffer(original, 16000, 1, 16);
    const info = parseWav(wav);
    const extracted = extractPcmFloat32(wav, info);

    expect(extracted.length).toBe(original.length);
    // Allow small quantization error from 16-bit encoding
    for (let i = 0; i < original.length; i++) {
      expect(extracted[i]).toBeCloseTo(original[i], 2);
    }
  });

  it('should convert stereo to mono by averaging', () => {
    // Create a stereo WAV with known values
    const monoSamples = new Float32Array([0.5, -0.5, 0.25]);
    const wav = createWavBuffer(monoSamples, 16000, 2, 16);
    const info = parseWav(wav);
    const extracted = extractPcmFloat32(wav, info);

    // Each channel has the same value, so averaging gives the same value
    expect(extracted.length).toBe(monoSamples.length);
    for (let i = 0; i < monoSamples.length; i++) {
      expect(extracted[i]).toBeCloseTo(monoSamples[i], 2);
    }
  });

  it('should extract 8-bit samples', () => {
    const original = new Float32Array([0, 0.5, -0.5]);
    const wav = createWavBuffer(original, 16000, 1, 8);
    const info = parseWav(wav);
    const extracted = extractPcmFloat32(wav, info);

    expect(extracted.length).toBe(original.length);
    // 8-bit has less precision
    for (let i = 0; i < original.length; i++) {
      expect(extracted[i]).toBeCloseTo(original[i], 1);
    }
  });

  it('should handle silence', () => {
    const silence = generateSilence(100, 16000);
    const wav = createWavBuffer(silence, 16000);
    const info = parseWav(wav);
    const extracted = extractPcmFloat32(wav, info);

    expect(extracted.length).toBe(silence.length);
    for (let i = 0; i < extracted.length; i++) {
      expect(extracted[i]).toBeCloseTo(0, 5);
    }
  });

  it('should handle a tone', () => {
    const tone = generateTone(100, 16000, 440, 0.8);
    const wav = createWavBuffer(tone, 16000);
    const info = parseWav(wav);
    const extracted = extractPcmFloat32(wav, info);

    expect(extracted.length).toBe(tone.length);
    // RMS of a sine wave with amplitude A is A/sqrt(2)
    let sumSquares = 0;
    for (let i = 0; i < extracted.length; i++) {
      sumSquares += extracted[i] * extracted[i];
    }
    const rms = Math.sqrt(sumSquares / extracted.length);
    expect(rms).toBeCloseTo(0.8 / Math.sqrt(2), 1);
  });
});

describe('resample', () => {
  it('should return same array when sample rates match', () => {
    const samples = new Float32Array([1, 2, 3, 4]);
    const result = resample(samples, 16000, 16000);
    expect(result).toBe(samples); // Same reference
  });

  it('should downsample from 44100 to 16000', () => {
    const tone = generateTone(100, 44100, 440, 0.5);
    const result = resample(tone, 44100, 16000);

    // Output length should be approximately (16000/44100) * input length
    const expectedLength = Math.floor(tone.length / (44100 / 16000));
    expect(result.length).toBe(expectedLength);
  });

  it('should upsample from 8000 to 16000', () => {
    const tone = generateTone(100, 8000, 440, 0.5);
    const result = resample(tone, 8000, 16000);

    const expectedLength = Math.floor(tone.length / (8000 / 16000));
    expect(result.length).toBe(expectedLength);
  });

  it('should preserve amplitude during resampling', () => {
    const amp = 0.7;
    const tone = generateTone(200, 44100, 100, amp);
    const result = resample(tone, 44100, 16000);

    // Check RMS is preserved (approximately)
    let sumSquares = 0;
    for (let i = 0; i < result.length; i++) {
      sumSquares += result[i] * result[i];
    }
    const rms = Math.sqrt(sumSquares / result.length);
    expect(rms).toBeCloseTo(amp / Math.sqrt(2), 1);
  });

  it('should handle empty input', () => {
    const result = resample(new Float32Array(0), 44100, 16000);
    expect(result.length).toBe(0);
  });
});

describe('encodeWav', () => {
  it('should produce a valid WAV file', () => {
    const samples = generateTone(100, 16000);
    const wav = encodeWav(samples, 16000);

    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');

    // Should be parseable
    const info = parseWav(wav);
    expect(info.sampleRate).toBe(16000);
    expect(info.channels).toBe(1);
    expect(info.bitDepth).toBe(16);
  });

  it('should roundtrip encode/decode', () => {
    const original = new Float32Array([0, 0.5, -0.5, 0.25, -0.25]);
    const wav = encodeWav(original, 16000);
    const info = parseWav(wav);
    const decoded = extractPcmFloat32(wav, info);

    expect(decoded.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(decoded[i]).toBeCloseTo(original[i], 2);
    }
  });

  it('should set correct file size in header', () => {
    const samples = new Float32Array(100);
    const wav = encodeWav(samples, 16000);

    const fileSize = wav.readUInt32LE(4) + 8;
    expect(fileSize).toBe(wav.length);
  });

  it('should set correct data size in header', () => {
    const samples = new Float32Array(100);
    const wav = encodeWav(samples, 16000);

    const dataSize = wav.readUInt32LE(40);
    expect(dataSize).toBe(100 * 2); // 16-bit = 2 bytes per sample
  });

  it('should handle empty samples', () => {
    const wav = encodeWav(new Float32Array(0), 16000);
    expect(wav.length).toBe(44); // Header only
    const info = parseWav(wav);
    expect(info.durationMs).toBe(0);
  });

  it('should clamp samples to [-1, 1]', () => {
    const samples = new Float32Array([2.0, -2.0, 1.5, -1.5]);
    const wav = encodeWav(samples, 16000);
    const info = parseWav(wav);
    const decoded = extractPcmFloat32(wav, info);

    // All values should be clamped to [-1, 1]
    for (let i = 0; i < decoded.length; i++) {
      expect(decoded[i]).toBeGreaterThanOrEqual(-1);
      expect(decoded[i]).toBeLessThanOrEqual(1);
    }
  });
});

describe('detectFormat', () => {
  it('should detect WAV format', () => {
    const wav = createWavBuffer(generateTone(10, 16000), 16000);
    expect(detectFormat(wav)).toBe('wav');
  });

  it('should detect MP3 with ID3 tag', () => {
    const buf = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]);
    expect(detectFormat(buf)).toBe('mp3');
  });

  it('should detect MP3 with sync word', () => {
    const buf = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
    expect(detectFormat(buf)).toBe('mp3');
  });

  it('should detect FLAC format', () => {
    const buf = Buffer.from([0x66, 0x4c, 0x61, 0x43, 0x00, 0x00, 0x00, 0x00]);
    expect(detectFormat(buf)).toBe('flac');
  });

  it('should detect OGG format', () => {
    const buf = Buffer.from([0x4f, 0x67, 0x67, 0x53, 0x00, 0x00, 0x00, 0x00]);
    expect(detectFormat(buf)).toBe('ogg');
  });

  it('should return unknown for unrecognized format', () => {
    const buf = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    expect(detectFormat(buf)).toBe('unknown');
  });

  it('should return unknown for buffer too small', () => {
    const buf = Buffer.from([0x00, 0x00]);
    expect(detectFormat(buf)).toBe('unknown');
  });

  it('should return unknown for empty buffer', () => {
    expect(detectFormat(Buffer.alloc(0))).toBe('unknown');
  });
});
