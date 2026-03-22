import { SpeechSegment, VADSegment } from './types';

/**
 * Options for the energy-based VAD.
 */
export interface EnergyVadOptions {
  /** RMS energy threshold for speech detection (0.0 - 1.0). Default: 0.01. */
  energyThreshold?: number;

  /** Frame size in milliseconds. Default: 30. */
  frameSizeMs?: number;

  /** Hop size in milliseconds (overlap between frames). Default: 15. */
  hopSizeMs?: number;

  /** Minimum silence duration in milliseconds to consider a gap between speech segments. Default: 500. */
  minSilenceMs?: number;

  /** Minimum speech duration in milliseconds. Segments shorter than this are discarded. Default: 250. */
  minSpeechMs?: number;
}

const DEFAULT_ENERGY_THRESHOLD = 0.01;
const DEFAULT_FRAME_SIZE_MS = 30;
const DEFAULT_HOP_SIZE_MS = 15;
const DEFAULT_MIN_SILENCE_MS = 500;
const DEFAULT_MIN_SPEECH_MS = 250;

/**
 * Compute the RMS (Root Mean Square) energy of a segment of audio samples.
 *
 * @param samples - Float32Array of audio samples
 * @param start - Start index
 * @param length - Number of samples to process
 * @returns RMS energy value (0.0 to 1.0)
 */
export function computeRms(samples: Float32Array, start: number, length: number): number {
  let sumSquares = 0;
  const end = Math.min(start + length, samples.length);
  const count = end - start;

  if (count <= 0) {
    return 0;
  }

  for (let i = start; i < end; i++) {
    sumSquares += samples[i] * samples[i];
  }

  return Math.sqrt(sumSquares / count);
}

/**
 * Classify audio frames as speech or silence based on RMS energy.
 *
 * @param samples - Float32Array of mono PCM samples
 * @param sampleRate - Sample rate in Hz
 * @param options - VAD options
 * @returns Array of boolean values, one per frame (true = speech)
 */
export function classifyFrames(
  samples: Float32Array,
  sampleRate: number,
  options: EnergyVadOptions = {},
): boolean[] {
  const frameSizeMs = options.frameSizeMs ?? DEFAULT_FRAME_SIZE_MS;
  const hopSizeMs = options.hopSizeMs ?? DEFAULT_HOP_SIZE_MS;
  const threshold = options.energyThreshold ?? DEFAULT_ENERGY_THRESHOLD;

  const frameSizeSamples = Math.floor((frameSizeMs / 1000) * sampleRate);
  const hopSizeSamples = Math.floor((hopSizeMs / 1000) * sampleRate);

  const frames: boolean[] = [];

  for (let start = 0; start < samples.length; start += hopSizeSamples) {
    const len = Math.min(frameSizeSamples, samples.length - start);
    const rms = computeRms(samples, start, len);
    frames.push(rms > threshold);
  }

  return frames;
}

/**
 * Convert frame classifications to speech segments with start/end times.
 *
 * @param frames - Array of boolean values (true = speech)
 * @param hopSizeMs - Hop size in milliseconds
 * @returns Array of raw speech segments
 */
export function framesToSegments(frames: boolean[], hopSizeMs: number): SpeechSegment[] {
  const segments: SpeechSegment[] = [];
  let inSpeech = false;
  let segmentStart = 0;

  for (let i = 0; i < frames.length; i++) {
    if (frames[i] && !inSpeech) {
      // Speech starts
      inSpeech = true;
      segmentStart = i * hopSizeMs / 1000;
    } else if (!frames[i] && inSpeech) {
      // Speech ends
      inSpeech = false;
      segments.push({
        start: segmentStart,
        end: i * hopSizeMs / 1000,
      });
    }
  }

  // If speech extends to the end
  if (inSpeech) {
    segments.push({
      start: segmentStart,
      end: frames.length * hopSizeMs / 1000,
    });
  }

  return segments;
}

/**
 * Merge adjacent speech segments separated by short silence gaps.
 *
 * @param segments - Array of speech segments
 * @param minSilenceMs - Minimum silence duration in ms to keep segments separate
 * @returns Merged speech segments
 */
export function mergeSegments(
  segments: SpeechSegment[],
  minSilenceMs: number,
): SpeechSegment[] {
  if (segments.length === 0) {
    return [];
  }

  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const merged: SpeechSegment[] = [{ ...sorted[0] }];
  const minSilenceSec = minSilenceMs / 1000;

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const current = sorted[i];
    const gap = current.start - last.end;

    if (gap < minSilenceSec) {
      // Merge: extend last segment
      last.end = Math.max(last.end, current.end);
    } else {
      // Keep separate
      merged.push({ ...current });
    }
  }

  return merged;
}

/**
 * Filter out speech segments shorter than the minimum duration.
 *
 * @param segments - Array of speech segments
 * @param minSpeechMs - Minimum speech duration in milliseconds
 * @returns Filtered speech segments
 */
export function filterShortSegments(
  segments: SpeechSegment[],
  minSpeechMs: number,
): SpeechSegment[] {
  const minSpeechSec = minSpeechMs / 1000;
  return segments.filter((s) => (s.end - s.start) >= minSpeechSec);
}

/**
 * Convert speech segments to VADSegment array (including silence gaps).
 *
 * @param speechSegments - Array of speech segments
 * @param totalDurationMs - Total duration of the audio in milliseconds
 * @returns Array of VADSegment objects covering the entire audio duration
 */
export function toVadSegments(
  speechSegments: SpeechSegment[],
  totalDurationMs: number,
): VADSegment[] {
  const vadSegments: VADSegment[] = [];
  const totalDurationSec = totalDurationMs / 1000;

  if (speechSegments.length === 0) {
    vadSegments.push({
      startMs: 0,
      endMs: totalDurationMs,
      type: 'silence',
    });
    return vadSegments;
  }

  const sorted = [...speechSegments].sort((a, b) => a.start - b.start);

  // Leading silence
  if (sorted[0].start > 0) {
    vadSegments.push({
      startMs: 0,
      endMs: sorted[0].start * 1000,
      type: 'silence',
    });
  }

  for (let i = 0; i < sorted.length; i++) {
    vadSegments.push({
      startMs: sorted[i].start * 1000,
      endMs: sorted[i].end * 1000,
      type: 'speech',
    });

    // Silence gap between this segment and the next
    if (i < sorted.length - 1) {
      const gapStart = sorted[i].end * 1000;
      const gapEnd = sorted[i + 1].start * 1000;
      if (gapEnd > gapStart) {
        vadSegments.push({
          startMs: gapStart,
          endMs: gapEnd,
          type: 'silence',
        });
      }
    }
  }

  // Trailing silence
  const lastEnd = sorted[sorted.length - 1].end * 1000;
  if (lastEnd < totalDurationMs) {
    vadSegments.push({
      startMs: lastEnd,
      endMs: totalDurationMs,
      type: 'silence',
    });
  }

  return vadSegments;
}

/**
 * Energy-based Voice Activity Detection.
 * Detects speech segments in audio using RMS energy levels.
 *
 * @param samples - Float32Array of mono PCM samples in [-1.0, 1.0]
 * @param sampleRate - Sample rate in Hz
 * @param options - VAD options
 * @returns Promise resolving to an array of speech segments
 */
export async function detectSpeech(
  samples: Float32Array,
  sampleRate: number,
  options: EnergyVadOptions = {},
): Promise<SpeechSegment[]> {
  const minSilenceMs = options.minSilenceMs ?? DEFAULT_MIN_SILENCE_MS;
  const minSpeechMs = options.minSpeechMs ?? DEFAULT_MIN_SPEECH_MS;

  // Step 1: Classify frames
  const frames = classifyFrames(samples, sampleRate, options);

  // Step 2: Convert to raw segments
  const hopSizeMs = options.hopSizeMs ?? DEFAULT_HOP_SIZE_MS;
  const rawSegments = framesToSegments(frames, hopSizeMs);

  // Step 3: Merge segments separated by short silences
  const merged = mergeSegments(rawSegments, minSilenceMs);

  // Step 4: Filter out short segments
  const filtered = filterShortSegments(merged, minSpeechMs);

  return filtered;
}
