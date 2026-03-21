import { describe, it, expect } from 'vitest';
import { findSplitCandidates, groupIntoChunks } from '../chunker';
import { SpeechSegment } from '../types';
import { generateTone, generateSilence, concatSamples } from './helpers';

describe('findSplitCandidates', () => {
  it('should return empty array for single segment', () => {
    const segments: SpeechSegment[] = [{ start: 0, end: 5 }];
    const candidates = findSplitCandidates(segments);
    expect(candidates).toHaveLength(0);
  });

  it('should return empty array for empty segments', () => {
    const candidates = findSplitCandidates([]);
    expect(candidates).toHaveLength(0);
  });

  it('should find a gap between two segments', () => {
    const segments: SpeechSegment[] = [
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ];
    const candidates = findSplitCandidates(segments);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].leftEnd).toBe(2);
    expect(candidates[0].rightStart).toBe(3);
    expect(candidates[0].gapDuration).toBe(1);
    expect(candidates[0].midpoint).toBe(2.5);
  });

  it('should find multiple gaps', () => {
    const segments: SpeechSegment[] = [
      { start: 0, end: 1 },
      { start: 2, end: 3 },
      { start: 5, end: 6 },
    ];
    const candidates = findSplitCandidates(segments);

    expect(candidates).toHaveLength(2);
    expect(candidates[0].gapDuration).toBe(1); // gap between seg 0 and 1
    expect(candidates[1].gapDuration).toBe(2); // gap between seg 1 and 2
  });

  it('should handle adjacent segments with no gap', () => {
    const segments: SpeechSegment[] = [
      { start: 0, end: 2 },
      { start: 2, end: 4 }, // No gap
    ];
    const candidates = findSplitCandidates(segments);
    expect(candidates).toHaveLength(0);
  });

  it('should set correct segment indices', () => {
    const segments: SpeechSegment[] = [
      { start: 0, end: 1 },
      { start: 2, end: 3 },
      { start: 4, end: 5 },
    ];
    const candidates = findSplitCandidates(segments);

    expect(candidates[0].segmentIndex).toBe(0);
    expect(candidates[1].segmentIndex).toBe(1);
  });
});

describe('groupIntoChunks', () => {
  const defaultOptions = {
    maxFileSizeBytes: 25 * 1024 * 1024, // 25MB
    maxDurationMs: Infinity,
    overlapMs: 1000,
    format: 'wav' as const,
    sampleRate: 16000,
    channels: 1,
  };

  it('should return single chunk with noSpeechDetected for no speech', () => {
    const silence = generateSilence(2000, 16000);
    const chunks = groupIntoChunks([], silence, defaultOptions);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].noSpeechDetected).toBe(true);
    expect(chunks[0].format).toBe('wav');
    expect(chunks[0].sizeBytes).toBeGreaterThan(44);
  });

  it('should produce one chunk for short audio', () => {
    const tone = generateTone(1000, 16000, 440, 0.5);
    const segments: SpeechSegment[] = [{ start: 0, end: 1.0 }];

    const chunks = groupIntoChunks(segments, tone, defaultOptions);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].startMs).toBe(0);
    expect(chunks[0].durationMs).toBeGreaterThan(0);
    expect(chunks[0].overlapMs).toBe(0); // First chunk has no overlap
  });

  it('should produce valid WAV data in chunks', () => {
    const tone = generateTone(1000, 16000, 440, 0.5);
    const segments: SpeechSegment[] = [{ start: 0, end: 1.0 }];

    const chunks = groupIntoChunks(segments, tone, defaultOptions);

    // Verify the chunk data starts with RIFF header
    expect(chunks[0].data.toString('ascii', 0, 4)).toBe('RIFF');
    expect(chunks[0].data.toString('ascii', 8, 12)).toBe('WAVE');
  });

  it('should split based on duration limit', () => {
    // 5 seconds of audio with speech segments
    const speech1 = generateTone(2000, 16000, 440, 0.5);
    const silence = generateSilence(1000, 16000);
    const speech2 = generateTone(2000, 16000, 440, 0.5);
    const audio = concatSamples(speech1, silence, speech2);

    const segments: SpeechSegment[] = [
      { start: 0, end: 2.0 },
      { start: 3.0, end: 5.0 },
    ];

    const chunks = groupIntoChunks(segments, audio, {
      ...defaultOptions,
      maxDurationMs: 3000, // 3 seconds max
    });

    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('should split based on file size limit', () => {
    // Create enough audio to exceed a small size limit
    const speech1 = generateTone(2000, 16000, 440, 0.5);
    const silence = generateSilence(1000, 16000);
    const speech2 = generateTone(2000, 16000, 440, 0.5);
    const audio = concatSamples(speech1, silence, speech2);

    const segments: SpeechSegment[] = [
      { start: 0, end: 2.0 },
      { start: 3.0, end: 5.0 },
    ];

    // Set a small size limit
    const smallSizeLimit = 50000; // ~50KB

    const chunks = groupIntoChunks(segments, audio, {
      ...defaultOptions,
      maxFileSizeBytes: smallSizeLimit,
    });

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // Each chunk should be within the size limit (approximately)
    for (const chunk of chunks) {
      expect(chunk.sizeBytes).toBeLessThanOrEqual(smallSizeLimit + 1000); // small margin
    }
  });

  it('should add overlap at chunk boundaries', () => {
    const speech1 = generateTone(2000, 16000, 440, 0.5);
    const silence = generateSilence(1000, 16000);
    const speech2 = generateTone(2000, 16000, 440, 0.5);
    const audio = concatSamples(speech1, silence, speech2);

    const segments: SpeechSegment[] = [
      { start: 0, end: 2.0 },
      { start: 3.0, end: 5.0 },
    ];

    const chunks = groupIntoChunks(segments, audio, {
      ...defaultOptions,
      maxDurationMs: 3000,
      overlapMs: 500,
    });

    if (chunks.length > 1) {
      // Second chunk should have overlap
      expect(chunks[1].overlapMs).toBeGreaterThan(0);
    }
  });

  it('should set correct indices', () => {
    const speech1 = generateTone(2000, 16000, 440, 0.5);
    const silence = generateSilence(1000, 16000);
    const speech2 = generateTone(2000, 16000, 440, 0.5);
    const audio = concatSamples(speech1, silence, speech2);

    const segments: SpeechSegment[] = [
      { start: 0, end: 2.0 },
      { start: 3.0, end: 5.0 },
    ];

    const chunks = groupIntoChunks(segments, audio, {
      ...defaultOptions,
      maxDurationMs: 3000,
    });

    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i);
    }
  });

  it('should set sizeBytes matching data length', () => {
    const tone = generateTone(1000, 16000, 440, 0.5);
    const segments: SpeechSegment[] = [{ start: 0, end: 1.0 }];

    const chunks = groupIntoChunks(segments, tone, defaultOptions);

    for (const chunk of chunks) {
      expect(chunk.sizeBytes).toBe(chunk.data.length);
    }
  });

  it('should handle multiple speech segments in one chunk', () => {
    // Three short speech segments with short gaps -- should all fit in one chunk
    const s1 = generateTone(500, 16000, 440, 0.5);
    const gap1 = generateSilence(200, 16000);
    const s2 = generateTone(500, 16000, 440, 0.5);
    const gap2 = generateSilence(200, 16000);
    const s3 = generateTone(500, 16000, 440, 0.5);
    const audio = concatSamples(s1, gap1, s2, gap2, s3);

    const segments: SpeechSegment[] = [
      { start: 0, end: 0.5 },
      { start: 0.7, end: 1.2 },
      { start: 1.4, end: 1.9 },
    ];

    const chunks = groupIntoChunks(segments, audio, defaultOptions);

    expect(chunks).toHaveLength(1);
  });

  it('should force-split continuous speech exceeding duration limit', () => {
    // 10 seconds of continuous speech with no silence
    const audio = generateTone(10000, 16000, 440, 0.5);
    const segments: SpeechSegment[] = [{ start: 0, end: 10.0 }];

    const chunks = groupIntoChunks(segments, audio, {
      ...defaultOptions,
      maxDurationMs: 3000, // 3 second limit
    });

    expect(chunks.length).toBeGreaterThanOrEqual(3);
    // Force-split chunks should be marked
    const forceSplitChunks = chunks.filter((c) => c.forceSplit);
    expect(forceSplitChunks.length).toBeGreaterThan(0);
  });
});
