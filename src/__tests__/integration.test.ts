import { describe, it, expect } from 'vitest';
import {
  chunk,
  parseWav,
  detectSpeech,
  parseSize,
  estimateWavSize,
  encodeWav,
  extractPcmFloat32,
  resample,
  detectFormat,
  detectSpeechSegments,
} from '../index';
import {
  createWavBuffer,
  createPatternedWav,
  generateTone,
  generateSilence,
  concatSamples,
} from './helpers';

describe('public API exports', () => {
  it('should export chunk function', () => {
    expect(typeof chunk).toBe('function');
  });

  it('should export detectSpeechSegments function', () => {
    expect(typeof detectSpeechSegments).toBe('function');
  });

  it('should export parseWav function', () => {
    expect(typeof parseWav).toBe('function');
  });

  it('should export detectSpeech function', () => {
    expect(typeof detectSpeech).toBe('function');
  });

  it('should export parseSize function', () => {
    expect(typeof parseSize).toBe('function');
  });

  it('should export estimateWavSize function', () => {
    expect(typeof estimateWavSize).toBe('function');
  });

  it('should export encodeWav function', () => {
    expect(typeof encodeWav).toBe('function');
  });

  it('should export extractPcmFloat32 function', () => {
    expect(typeof extractPcmFloat32).toBe('function');
  });

  it('should export resample function', () => {
    expect(typeof resample).toBe('function');
  });

  it('should export detectFormat function', () => {
    expect(typeof detectFormat).toBe('function');
  });
});

describe('end-to-end: chunk a recording', () => {
  it('should chunk a 5-second recording with speech-silence pattern', async () => {
    // Simulate: 2s speech, 1s silence, 2s speech
    const wav = createPatternedWav([
      { type: 'speech', durationMs: 2000 },
      { type: 'silence', durationMs: 1000 },
      { type: 'speech', durationMs: 2000 },
    ]);

    const result = await chunk(wav, {
      maxDurationMs: 3000,
      overlapMs: 500,
    });

    expect(result.sourceFormat).toBe('wav');
    expect(result.totalDurationMs).toBeGreaterThan(4000);
    expect(result.chunks.length).toBeGreaterThanOrEqual(1);

    // Verify all chunks have valid WAV data
    for (const c of result.chunks) {
      expect(c.data.length).toBeGreaterThan(44);
      const info = parseWav(c.data);
      expect(info.sampleRate).toBe(16000);
      expect(info.channels).toBe(1);
    }
  });

  it('should chunk a long recording into multiple pieces', async () => {
    // 10 seconds of alternating speech and silence
    const wav = createPatternedWav([
      { type: 'speech', durationMs: 2000 },
      { type: 'silence', durationMs: 800 },
      { type: 'speech', durationMs: 2000 },
      { type: 'silence', durationMs: 800 },
      { type: 'speech', durationMs: 2000 },
      { type: 'silence', durationMs: 800 },
      { type: 'speech', durationMs: 2000 },
    ]);

    const result = await chunk(wav, {
      maxDurationMs: 4000,
    });

    expect(result.chunks.length).toBeGreaterThanOrEqual(2);

    // Chunks should be in order
    for (let i = 1; i < result.chunks.length; i++) {
      expect(result.chunks[i].index).toBe(i);
    }
  });

  it('should handle resampling from 44.1kHz stereo to 16kHz mono', async () => {
    const samples = concatSamples(
      generateTone(1000, 44100, 440, 0.5),
      generateSilence(500, 44100),
      generateTone(1000, 44100, 440, 0.5),
    );
    const wav = createWavBuffer(samples, 44100, 2, 16);

    const result = await chunk(wav, { sampleRate: 16000 });

    expect(result.sourceFormat).toBe('wav');
    expect(result.chunks.length).toBeGreaterThanOrEqual(1);

    // Output should be 16kHz mono
    for (const c of result.chunks) {
      const info = parseWav(c.data);
      expect(info.sampleRate).toBe(16000);
      expect(info.channels).toBe(1);
    }
  });

  it('should produce chunks within the 25mb default limit', async () => {
    const wav = createPatternedWav([
      { type: 'speech', durationMs: 5000 },
    ]);

    const result = await chunk(wav);

    for (const c of result.chunks) {
      expect(c.sizeBytes).toBeLessThanOrEqual(25 * 1024 * 1024);
    }
  });

  it('should roundtrip: chunk then parse each chunk', async () => {
    const wav = createPatternedWav([
      { type: 'speech', durationMs: 1500 },
      { type: 'silence', durationMs: 800 },
      { type: 'speech', durationMs: 1500 },
    ]);

    const result = await chunk(wav, { maxDurationMs: 2500 });

    for (const c of result.chunks) {
      // Each chunk should be a valid WAV that can be parsed
      const info = parseWav(c.data);
      expect(info.sampleRate).toBe(16000);
      expect(info.channels).toBe(1);
      expect(info.bitDepth).toBe(16);
      expect(info.durationMs).toBeGreaterThan(0);

      // Should be able to extract PCM from each chunk
      const pcm = extractPcmFloat32(c.data, info);
      expect(pcm.length).toBeGreaterThan(0);
    }
  });
});

describe('end-to-end: WAV encode/decode roundtrip', () => {
  it('should preserve a sine wave through encode/decode', () => {
    const original = generateTone(200, 16000, 440, 0.7);
    const wav = encodeWav(original, 16000);
    const info = parseWav(wav);
    const decoded = extractPcmFloat32(wav, info);

    expect(decoded.length).toBe(original.length);

    // Compute correlation to verify waveform is preserved
    let dotProduct = 0;
    let normOrig = 0;
    let normDec = 0;
    for (let i = 0; i < original.length; i++) {
      dotProduct += original[i] * decoded[i];
      normOrig += original[i] * original[i];
      normDec += decoded[i] * decoded[i];
    }
    const correlation = dotProduct / (Math.sqrt(normOrig) * Math.sqrt(normDec));
    expect(correlation).toBeGreaterThan(0.99);
  });

  it('should preserve silence through encode/decode', () => {
    const original = generateSilence(200, 16000);
    const wav = encodeWav(original, 16000);
    const info = parseWav(wav);
    const decoded = extractPcmFloat32(wav, info);

    expect(decoded.length).toBe(original.length);
    for (let i = 0; i < decoded.length; i++) {
      expect(Math.abs(decoded[i])).toBeLessThan(0.001);
    }
  });
});

describe('end-to-end: VAD pipeline', () => {
  it('should detect speech in a tone-silence-tone pattern', async () => {
    const tone1 = generateTone(800, 16000, 440, 0.5);
    const silence = generateSilence(1000, 16000);
    const tone2 = generateTone(800, 16000, 440, 0.5);
    const audio = concatSamples(tone1, silence, tone2);

    const segments = await detectSpeech(audio, 16000, {
      energyThreshold: 0.01,
      minSilenceMs: 500,
      minSpeechMs: 250,
    });

    expect(segments).toHaveLength(2);
  });

  it('should handle complex speech patterns', async () => {
    // Short-silence-long-silence-short pattern
    const s1 = generateTone(400, 16000, 440, 0.5);
    const gap1 = generateSilence(200, 16000);
    const s2 = generateTone(400, 16000, 440, 0.5);
    const gap2 = generateSilence(1500, 16000);
    const s3 = generateTone(400, 16000, 440, 0.5);
    const audio = concatSamples(s1, gap1, s2, gap2, s3);

    const segments = await detectSpeech(audio, 16000, {
      energyThreshold: 0.01,
      minSilenceMs: 500,
      minSpeechMs: 250,
    });

    // s1 and s2 should be merged (gap < 500ms), s3 separate
    expect(segments).toHaveLength(2);
  });
});

describe('size estimation accuracy', () => {
  it('should estimate WAV size accurately for 1 second', () => {
    const samples = generateTone(1000, 16000, 440, 0.5);
    const wav = encodeWav(samples, 16000, 1, 16);
    const estimated = estimateWavSize(1000, 16000, 1, 16);

    // Estimated and actual should be very close
    expect(Math.abs(estimated - wav.length)).toBeLessThan(100);
  });

  it('should estimate WAV size accurately for 10 seconds', () => {
    const samples = generateTone(10000, 16000, 440, 0.5);
    const wav = encodeWav(samples, 16000, 1, 16);
    const estimated = estimateWavSize(10000, 16000, 1, 16);

    expect(Math.abs(estimated - wav.length)).toBeLessThan(100);
  });
});
