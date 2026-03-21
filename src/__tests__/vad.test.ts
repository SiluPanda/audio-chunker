import { describe, it, expect } from 'vitest';
import {
  computeRms,
  classifyFrames,
  framesToSegments,
  mergeSegments,
  filterShortSegments,
  toVadSegments,
  detectSpeech,
} from '../vad';
import { generateTone, generateSilence, concatSamples } from './helpers';

describe('computeRms', () => {
  it('should return 0 for silence', () => {
    const silence = new Float32Array(480);
    expect(computeRms(silence, 0, 480)).toBe(0);
  });

  it('should compute RMS for a DC signal', () => {
    const dc = new Float32Array(100).fill(0.5);
    expect(computeRms(dc, 0, 100)).toBeCloseTo(0.5, 5);
  });

  it('should compute RMS for a sine wave', () => {
    const tone = generateTone(100, 16000, 440, 1.0);
    const rms = computeRms(tone, 0, tone.length);
    // RMS of a sine wave with amplitude 1.0 is 1/sqrt(2) ≈ 0.707
    expect(rms).toBeCloseTo(1.0 / Math.sqrt(2), 1);
  });

  it('should handle partial range', () => {
    const samples = new Float32Array(100);
    samples.fill(0.5, 0, 50);
    samples.fill(0, 50, 100);

    const rmsFirst50 = computeRms(samples, 0, 50);
    expect(rmsFirst50).toBeCloseTo(0.5, 5);

    const rmsLast50 = computeRms(samples, 50, 50);
    expect(rmsLast50).toBe(0);
  });

  it('should return 0 for zero-length segment', () => {
    const samples = new Float32Array(100);
    expect(computeRms(samples, 0, 0)).toBe(0);
  });

  it('should handle start beyond array length', () => {
    const samples = new Float32Array(100);
    expect(computeRms(samples, 200, 50)).toBe(0);
  });
});

describe('classifyFrames', () => {
  it('should classify silence frames as non-speech', () => {
    const silence = generateSilence(500, 16000);
    const frames = classifyFrames(silence, 16000);

    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((f) => f === false)).toBe(true);
  });

  it('should classify loud tone frames as speech', () => {
    const tone = generateTone(500, 16000, 440, 0.5);
    const frames = classifyFrames(tone, 16000, { energyThreshold: 0.01 });

    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((f) => f === true)).toBe(true);
  });

  it('should classify very quiet tone as non-speech with default threshold', () => {
    const quietTone = generateTone(500, 16000, 440, 0.005);
    const frames = classifyFrames(quietTone, 16000, { energyThreshold: 0.01 });

    expect(frames.every((f) => f === false)).toBe(true);
  });

  it('should detect speech-silence boundaries', () => {
    const speech = generateTone(300, 16000, 440, 0.5);
    const silence = generateSilence(300, 16000);
    const audio = concatSamples(speech, silence);

    const frames = classifyFrames(audio, 16000, { energyThreshold: 0.01 });

    // First ~half should be speech, second half silence
    const midIdx = Math.floor(frames.length / 2);
    const speechFrames = frames.slice(0, midIdx);
    const silenceFrames = frames.slice(midIdx);

    expect(speechFrames.filter((f) => f).length).toBeGreaterThan(speechFrames.length * 0.8);
    expect(silenceFrames.filter((f) => !f).length).toBeGreaterThan(silenceFrames.length * 0.8);
  });

  it('should respect custom frame and hop sizes', () => {
    const audio = generateTone(500, 16000, 440, 0.5);
    const frames20ms = classifyFrames(audio, 16000, { frameSizeMs: 20, hopSizeMs: 10 });
    const frames50ms = classifyFrames(audio, 16000, { frameSizeMs: 50, hopSizeMs: 25 });

    // Smaller hop size should produce more frames
    expect(frames20ms.length).toBeGreaterThan(frames50ms.length);
  });
});

describe('framesToSegments', () => {
  it('should return empty array for no speech frames', () => {
    const frames = [false, false, false, false];
    expect(framesToSegments(frames, 15)).toEqual([]);
  });

  it('should return a single segment for continuous speech', () => {
    const frames = [true, true, true, true];
    const segments = framesToSegments(frames, 15);

    expect(segments).toHaveLength(1);
    expect(segments[0].start).toBe(0);
    expect(segments[0].end).toBeCloseTo(4 * 15 / 1000, 5);
  });

  it('should detect two separate speech segments', () => {
    const frames = [true, true, false, false, true, true];
    const segments = framesToSegments(frames, 15);

    expect(segments).toHaveLength(2);
    expect(segments[0].start).toBe(0);
    expect(segments[1].start).toBeCloseTo(4 * 15 / 1000, 5);
  });

  it('should handle speech at the end', () => {
    const frames = [false, false, true, true];
    const segments = framesToSegments(frames, 15);

    expect(segments).toHaveLength(1);
    expect(segments[0].start).toBeCloseTo(2 * 15 / 1000, 5);
    expect(segments[0].end).toBeCloseTo(4 * 15 / 1000, 5);
  });

  it('should handle single-frame speech', () => {
    const frames = [false, true, false];
    const segments = framesToSegments(frames, 15);

    expect(segments).toHaveLength(1);
    expect(segments[0].start).toBeCloseTo(1 * 15 / 1000, 5);
    expect(segments[0].end).toBeCloseTo(2 * 15 / 1000, 5);
  });
});

describe('mergeSegments', () => {
  it('should return empty array for empty input', () => {
    expect(mergeSegments([], 500)).toEqual([]);
  });

  it('should return single segment as-is', () => {
    const segments = [{ start: 1.0, end: 2.0 }];
    const result = mergeSegments(segments, 500);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ start: 1.0, end: 2.0 });
  });

  it('should merge segments with gap smaller than threshold', () => {
    const segments = [
      { start: 1.0, end: 2.0 },
      { start: 2.3, end: 3.0 }, // 300ms gap < 500ms threshold
    ];
    const result = mergeSegments(segments, 500);

    expect(result).toHaveLength(1);
    expect(result[0].start).toBe(1.0);
    expect(result[0].end).toBe(3.0);
  });

  it('should not merge segments with gap larger than threshold', () => {
    const segments = [
      { start: 1.0, end: 2.0 },
      { start: 3.0, end: 4.0 }, // 1000ms gap > 500ms threshold
    ];
    const result = mergeSegments(segments, 500);

    expect(result).toHaveLength(2);
  });

  it('should merge multiple adjacent segments', () => {
    const segments = [
      { start: 0.0, end: 1.0 },
      { start: 1.2, end: 2.0 }, // 200ms gap
      { start: 2.1, end: 3.0 }, // 100ms gap
    ];
    const result = mergeSegments(segments, 500);

    expect(result).toHaveLength(1);
    expect(result[0].start).toBe(0.0);
    expect(result[0].end).toBe(3.0);
  });

  it('should merge some but not all segments', () => {
    const segments = [
      { start: 0.0, end: 1.0 },
      { start: 1.2, end: 2.0 }, // 200ms gap -> merge
      { start: 3.5, end: 4.0 }, // 1500ms gap -> separate
      { start: 4.1, end: 5.0 }, // 100ms gap -> merge
    ];
    const result = mergeSegments(segments, 500);

    expect(result).toHaveLength(2);
    expect(result[0].start).toBe(0.0);
    expect(result[0].end).toBe(2.0);
    expect(result[1].start).toBe(3.5);
    expect(result[1].end).toBe(5.0);
  });

  it('should sort unsorted input', () => {
    const segments = [
      { start: 3.0, end: 4.0 },
      { start: 1.0, end: 2.0 },
    ];
    const result = mergeSegments(segments, 500);

    expect(result).toHaveLength(2);
    expect(result[0].start).toBe(1.0);
    expect(result[1].start).toBe(3.0);
  });
});

describe('filterShortSegments', () => {
  it('should return empty array for empty input', () => {
    expect(filterShortSegments([], 250)).toEqual([]);
  });

  it('should keep segments longer than minimum', () => {
    const segments = [{ start: 0.0, end: 1.0 }]; // 1000ms
    const result = filterShortSegments(segments, 250);
    expect(result).toHaveLength(1);
  });

  it('should discard segments shorter than minimum', () => {
    const segments = [{ start: 0.0, end: 0.1 }]; // 100ms
    const result = filterShortSegments(segments, 250);
    expect(result).toHaveLength(0);
  });

  it('should keep segments exactly at minimum', () => {
    const segments = [{ start: 0.0, end: 0.25 }]; // 250ms
    const result = filterShortSegments(segments, 250);
    expect(result).toHaveLength(1);
  });

  it('should filter mixed segments', () => {
    const segments = [
      { start: 0.0, end: 0.1 },  // 100ms - discard
      { start: 1.0, end: 2.0 },  // 1000ms - keep
      { start: 3.0, end: 3.05 }, // 50ms - discard
      { start: 4.0, end: 5.5 },  // 1500ms - keep
    ];
    const result = filterShortSegments(segments, 250);
    expect(result).toHaveLength(2);
    expect(result[0].start).toBe(1.0);
    expect(result[1].start).toBe(4.0);
  });
});

describe('toVadSegments', () => {
  it('should return all silence for no speech segments', () => {
    const result = toVadSegments([], 5000);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('silence');
    expect(result[0].startMs).toBe(0);
    expect(result[0].endMs).toBe(5000);
  });

  it('should handle single speech segment with leading and trailing silence', () => {
    const segments = [{ start: 1.0, end: 3.0 }];
    const result = toVadSegments(segments, 5000);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ startMs: 0, endMs: 1000, type: 'silence' });
    expect(result[1]).toEqual({ startMs: 1000, endMs: 3000, type: 'speech' });
    expect(result[2]).toEqual({ startMs: 3000, endMs: 5000, type: 'silence' });
  });

  it('should handle speech starting at the beginning', () => {
    const segments = [{ start: 0, end: 2.0 }];
    const result = toVadSegments(segments, 5000);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ startMs: 0, endMs: 2000, type: 'speech' });
    expect(result[1]).toEqual({ startMs: 2000, endMs: 5000, type: 'silence' });
  });

  it('should handle speech ending at the end', () => {
    const segments = [{ start: 3.0, end: 5.0 }];
    const result = toVadSegments(segments, 5000);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ startMs: 0, endMs: 3000, type: 'silence' });
    expect(result[1]).toEqual({ startMs: 3000, endMs: 5000, type: 'speech' });
  });

  it('should interleave speech and silence for multiple segments', () => {
    const segments = [
      { start: 1.0, end: 2.0 },
      { start: 3.0, end: 4.0 },
    ];
    const result = toVadSegments(segments, 5000);

    expect(result).toHaveLength(5);
    expect(result[0].type).toBe('silence'); // 0-1s
    expect(result[1].type).toBe('speech');  // 1-2s
    expect(result[2].type).toBe('silence'); // 2-3s
    expect(result[3].type).toBe('speech');  // 3-4s
    expect(result[4].type).toBe('silence'); // 4-5s
  });

  it('should cover the entire duration', () => {
    const segments = [{ start: 1.0, end: 2.0 }];
    const result = toVadSegments(segments, 5000);

    // First segment should start at 0, last should end at 5000
    expect(result[0].startMs).toBe(0);
    expect(result[result.length - 1].endMs).toBe(5000);
  });
});

describe('detectSpeech', () => {
  it('should detect no speech in silence', async () => {
    const silence = generateSilence(1000, 16000);
    const segments = await detectSpeech(silence, 16000);
    expect(segments).toHaveLength(0);
  });

  it('should detect a continuous tone as speech', async () => {
    const tone = generateTone(1000, 16000, 440, 0.5);
    const segments = await detectSpeech(tone, 16000, {
      energyThreshold: 0.01,
      minSpeechMs: 100,
    });

    expect(segments.length).toBeGreaterThanOrEqual(1);
    // The speech should cover most of the audio
    const totalSpeechDuration = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
    expect(totalSpeechDuration).toBeGreaterThan(0.8); // > 800ms of 1000ms
  });

  it('should detect speech-silence-speech pattern', async () => {
    const speech1 = generateTone(500, 16000, 440, 0.5);
    const silence = generateSilence(1000, 16000);
    const speech2 = generateTone(500, 16000, 440, 0.5);
    const audio = concatSamples(speech1, silence, speech2);

    const segments = await detectSpeech(audio, 16000, {
      energyThreshold: 0.01,
      minSilenceMs: 500,
      minSpeechMs: 100,
    });

    expect(segments).toHaveLength(2);
    // First segment should be near 0-0.5s
    expect(segments[0].start).toBeCloseTo(0, 0);
    expect(segments[0].end).toBeCloseTo(0.5, 0);
    // Second segment should be near 1.5-2.0s
    expect(segments[1].start).toBeCloseTo(1.5, 0);
    expect(segments[1].end).toBeCloseTo(2.0, 0);
  });

  it('should merge speech segments with short silence between them', async () => {
    const speech1 = generateTone(500, 16000, 440, 0.5);
    const shortSilence = generateSilence(200, 16000); // < 500ms default
    const speech2 = generateTone(500, 16000, 440, 0.5);
    const audio = concatSamples(speech1, shortSilence, speech2);

    const segments = await detectSpeech(audio, 16000, {
      energyThreshold: 0.01,
      minSilenceMs: 500,
      minSpeechMs: 100,
    });

    // Should be merged into 1 segment
    expect(segments).toHaveLength(1);
  });

  it('should filter out short speech bursts', async () => {
    // A very short burst (50ms) followed by long silence
    const shortBurst = generateTone(50, 16000, 440, 0.5);
    const silence = generateSilence(1000, 16000);
    const audio = concatSamples(shortBurst, silence);

    const segments = await detectSpeech(audio, 16000, {
      energyThreshold: 0.01,
      minSpeechMs: 250,
    });

    // Short burst should be filtered out
    expect(segments).toHaveLength(0);
  });

  it('should respect custom energy threshold', async () => {
    const quietTone = generateTone(1000, 16000, 440, 0.02);

    // With low threshold, detect as speech
    const segmentsLow = await detectSpeech(quietTone, 16000, {
      energyThreshold: 0.005,
      minSpeechMs: 100,
    });
    expect(segmentsLow.length).toBeGreaterThanOrEqual(1);

    // With high threshold, detect as silence
    const segmentsHigh = await detectSpeech(quietTone, 16000, {
      energyThreshold: 0.05,
      minSpeechMs: 100,
    });
    expect(segmentsHigh).toHaveLength(0);
  });
});
