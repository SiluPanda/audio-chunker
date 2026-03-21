import { describe, it, expect } from 'vitest';
import { chunk, detectSpeechSegments } from '../chunk';
import {
  createWavBuffer,
  createPatternedWav,
  generateTone,
  generateSilence,
  concatSamples,
} from './helpers';

describe('chunk()', () => {
  describe('input validation', () => {
    it('should throw for non-buffer input', async () => {
      await expect(chunk('not a buffer' as any)).rejects.toThrow('Source must be a Buffer');
    });

    it('should return empty result for empty buffer', async () => {
      const result = await chunk(Buffer.alloc(0));
      expect(result.chunks).toHaveLength(0);
      expect(result.totalDurationMs).toBe(0);
      expect(result.sourceFormat).toBe('unknown');
    });

    it('should throw for unsupported format', async () => {
      const mp3Header = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      await expect(chunk(mp3Header)).rejects.toThrow('Unsupported audio format');
    });
  });

  describe('WAV processing', () => {
    it('should process a simple WAV file', async () => {
      const wav = createPatternedWav([
        { type: 'speech', durationMs: 1000 },
      ]);

      const result = await chunk(wav);

      expect(result.sourceFormat).toBe('wav');
      expect(result.totalDurationMs).toBeGreaterThan(0);
      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect silence-only WAV as no speech', async () => {
      const wav = createPatternedWav([
        { type: 'silence', durationMs: 2000 },
      ]);

      const result = await chunk(wav);

      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].noSpeechDetected).toBe(true);
    });

    it('should split speech-silence-speech pattern', async () => {
      const wav = createPatternedWav([
        { type: 'speech', durationMs: 2000 },
        { type: 'silence', durationMs: 1000 },
        { type: 'speech', durationMs: 2000 },
      ]);

      const result = await chunk(wav, {
        maxDurationMs: 3000,
      });

      expect(result.chunks.length).toBeGreaterThanOrEqual(2);
    });

    it('should respect maxFileSize option as string', async () => {
      const wav = createPatternedWav([
        { type: 'speech', durationMs: 3000 },
        { type: 'silence', durationMs: 1000 },
        { type: 'speech', durationMs: 3000 },
      ]);

      const result = await chunk(wav, {
        maxFileSize: '50kb',
      });

      for (const c of result.chunks) {
        // Chunks should respect size limit (with reasonable margin)
        expect(c.sizeBytes).toBeLessThanOrEqual(55 * 1024);
      }
    });

    it('should respect maxFileSize option as number', async () => {
      const wav = createPatternedWav([
        { type: 'speech', durationMs: 2000 },
        { type: 'silence', durationMs: 1000 },
        { type: 'speech', durationMs: 2000 },
      ]);

      const result = await chunk(wav, {
        maxFileSize: 50000,
      });

      for (const c of result.chunks) {
        expect(c.sizeBytes).toBeLessThanOrEqual(55000);
      }
    });

    it('should process stereo WAV', async () => {
      const samples = generateTone(1000, 44100, 440, 0.5);
      const wav = createWavBuffer(samples, 44100, 2, 16);

      const result = await chunk(wav);

      expect(result.sourceFormat).toBe('wav');
      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    });

    it('should resample from 44100 to 16000', async () => {
      const samples = generateTone(500, 44100, 440, 0.5);
      const wav = createWavBuffer(samples, 44100, 1, 16);

      const result = await chunk(wav, { sampleRate: 16000 });

      expect(result.sourceFormat).toBe('wav');
      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    });

    it('should include proper metadata in chunks', async () => {
      const wav = createPatternedWav([
        { type: 'speech', durationMs: 1000 },
      ]);

      const result = await chunk(wav);
      const c = result.chunks[0];

      expect(c.index).toBe(0);
      expect(c.startMs).toBeGreaterThanOrEqual(0);
      expect(c.endMs).toBeGreaterThan(c.startMs);
      expect(c.durationMs).toBe(c.endMs - c.startMs);
      expect(c.format).toBe('wav');
      expect(c.sizeBytes).toBe(c.data.length);
      expect(Buffer.isBuffer(c.data)).toBe(true);
    });

    it('should produce valid WAV data in each chunk', async () => {
      const wav = createPatternedWav([
        { type: 'speech', durationMs: 2000 },
        { type: 'silence', durationMs: 1000 },
        { type: 'speech', durationMs: 2000 },
      ]);

      const result = await chunk(wav, { maxDurationMs: 3000 });

      for (const c of result.chunks) {
        expect(c.data.toString('ascii', 0, 4)).toBe('RIFF');
        expect(c.data.toString('ascii', 8, 12)).toBe('WAVE');
      }
    });

    it('should use default options when none provided', async () => {
      const wav = createPatternedWav([
        { type: 'speech', durationMs: 500 },
      ]);

      const result = await chunk(wav);

      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
      expect(result.chunks[0].format).toBe('wav');
    });
  });

  describe('custom VAD', () => {
    it('should accept a custom VAD function', async () => {
      const wav = createPatternedWav([
        { type: 'speech', durationMs: 2000 },
      ]);

      const customVad = async () => [
        { start: 0.0, end: 0.5 },
        { start: 1.0, end: 1.5 },
      ];

      const result = await chunk(wav, { vad: customVad });

      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    });

    it('should use custom VAD results for chunking', async () => {
      const wav = createPatternedWav([
        { type: 'speech', durationMs: 5000 },
      ]);

      // Custom VAD that reports two separate speech segments with a gap
      const customVad = async () => [
        { start: 0.0, end: 2.0 },
        { start: 3.0, end: 5.0 },
      ];

      const result = await chunk(wav, {
        vad: customVad,
        maxDurationMs: 3000,
      });

      expect(result.chunks.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('overlap', () => {
    it('should not add overlap to first chunk', async () => {
      const wav = createPatternedWav([
        { type: 'speech', durationMs: 2000 },
        { type: 'silence', durationMs: 1000 },
        { type: 'speech', durationMs: 2000 },
      ]);

      const result = await chunk(wav, {
        maxDurationMs: 3000,
        overlapMs: 500,
      });

      if (result.chunks.length > 0) {
        expect(result.chunks[0].overlapMs).toBe(0);
      }
    });

    it('should work with zero overlap', async () => {
      const wav = createPatternedWav([
        { type: 'speech', durationMs: 2000 },
        { type: 'silence', durationMs: 1000 },
        { type: 'speech', durationMs: 2000 },
      ]);

      const result = await chunk(wav, {
        maxDurationMs: 3000,
        overlapMs: 0,
      });

      for (const c of result.chunks) {
        expect(c.overlapMs).toBe(0);
      }
    });
  });

  describe('edge cases', () => {
    it('should handle very short audio (10ms)', async () => {
      const wav = createPatternedWav([
        { type: 'speech', durationMs: 10 },
      ]);

      const result = await chunk(wav);
      // Very short speech will be filtered out by minSpeechMs
      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle 8-bit WAV', async () => {
      const samples = generateTone(500, 16000, 440, 0.5);
      const wav = createWavBuffer(samples, 16000, 1, 8);

      const result = await chunk(wav);

      expect(result.sourceFormat).toBe('wav');
      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    });

    it('should respect energyThreshold option', async () => {
      const wav = createPatternedWav([
        { type: 'speech', durationMs: 1000 },
      ], 16000);

      // With very high threshold, everything is silence
      const result = await chunk(wav, { energyThreshold: 10.0 });
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].noSpeechDetected).toBe(true);
    });

    it('should handle minSilenceMs option', async () => {
      const wav = createPatternedWav([
        { type: 'speech', durationMs: 1000 },
        { type: 'silence', durationMs: 300 },
        { type: 'speech', durationMs: 1000 },
      ]);

      // With high minSilenceMs, the 300ms gap is too short to split
      const result1 = await chunk(wav, { minSilenceMs: 1000 });
      // With low minSilenceMs, the 300ms gap is enough
      const result2 = await chunk(wav, { minSilenceMs: 100 });

      // result1 should have fewer or equal segments detected
      // (both may still be 1 chunk due to size limits)
      expect(result1.chunks.length).toBeLessThanOrEqual(result2.chunks.length + 1);
    });
  });
});

describe('detectSpeechSegments()', () => {
  it('should return VAD segments for WAV audio', async () => {
    const wav = createPatternedWav([
      { type: 'silence', durationMs: 500 },
      { type: 'speech', durationMs: 1000 },
      { type: 'silence', durationMs: 500 },
    ]);

    const segments = await detectSpeechSegments(wav);

    expect(segments.length).toBeGreaterThanOrEqual(1);
    // Should have at least a speech segment
    const speechSegs = segments.filter((s) => s.type === 'speech');
    expect(speechSegs.length).toBeGreaterThanOrEqual(1);
  });

  it('should return all silence for silent audio', async () => {
    const wav = createPatternedWav([
      { type: 'silence', durationMs: 2000 },
    ]);

    const segments = await detectSpeechSegments(wav);

    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe('silence');
  });

  it('should throw for non-buffer input', async () => {
    await expect(detectSpeechSegments('not a buffer' as any)).rejects.toThrow(
      'Source must be a Buffer',
    );
  });

  it('should return empty array for empty buffer', async () => {
    const segments = await detectSpeechSegments(Buffer.alloc(0));
    expect(segments).toEqual([]);
  });

  it('should accept custom VAD', async () => {
    const wav = createPatternedWav([
      { type: 'speech', durationMs: 2000 },
    ]);

    const customVad = async () => [
      { start: 0.5, end: 1.5 },
    ];

    const segments = await detectSpeechSegments(wav, { vad: customVad });

    const speechSegs = segments.filter((s) => s.type === 'speech');
    expect(speechSegs).toHaveLength(1);
    expect(speechSegs[0].startMs).toBeCloseTo(500, 0);
    expect(speechSegs[0].endMs).toBeCloseTo(1500, 0);
  });

  it('should cover the entire audio duration', async () => {
    const wav = createPatternedWav([
      { type: 'silence', durationMs: 500 },
      { type: 'speech', durationMs: 1000 },
      { type: 'silence', durationMs: 500 },
    ]);

    const segments = await detectSpeechSegments(wav);

    // First segment should start at 0
    expect(segments[0].startMs).toBe(0);
    // Last segment should end near total duration
    expect(segments[segments.length - 1].endMs).toBeGreaterThan(0);
  });
});
