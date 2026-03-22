import { AudioChunk, AudioFormat, SpeechSegment } from './types';
import { estimateWavSize } from './size';
import { encodeWav } from './wav';

/**
 * A candidate split point between two speech segments.
 */
interface SplitCandidate {
  /** Index of the speech segment before this gap. */
  segmentIndex: number;

  /** End time of the speech segment before the gap (seconds). */
  leftEnd: number;

  /** Start time of the speech segment after the gap (seconds). */
  rightStart: number;

  /** Duration of the silence gap (seconds). */
  gapDuration: number;

  /** Midpoint of the silence gap (seconds). */
  midpoint: number;
}

/**
 * Options for the chunker.
 */
export interface ChunkerOptions {
  /** Maximum file size per chunk in bytes. */
  maxFileSizeBytes: number;

  /** Maximum duration per chunk in milliseconds. */
  maxDurationMs: number;

  /** Overlap duration in milliseconds. */
  overlapMs: number;

  /** Output format. */
  format: AudioFormat;

  /** Sample rate in Hz. */
  sampleRate: number;

  /** Number of channels. */
  channels: number;
}

/**
 * Identify all candidate split points (silence gaps between speech segments).
 *
 * @param segments - Merged, filtered speech segments sorted by start time
 * @returns Array of split candidates sorted by gap duration (longest first)
 */
export function findSplitCandidates(segments: SpeechSegment[]): SplitCandidate[] {
  const candidates: SplitCandidate[] = [];

  for (let i = 0; i < segments.length - 1; i++) {
    const leftEnd = segments[i].end;
    const rightStart = segments[i + 1].start;
    const gapDuration = rightStart - leftEnd;

    if (gapDuration > 0) {
      candidates.push({
        segmentIndex: i,
        leftEnd,
        rightStart,
        gapDuration,
        midpoint: leftEnd + gapDuration / 2,
      });
    }
  }

  return candidates;
}

/**
 * Check if a duration (in ms) starting from a given point would exceed limits.
 */
function exceedsLimits(
  durationMs: number,
  maxDurationMs: number,
  maxFileSizeBytes: number,
  sampleRate: number,
  channels: number,
): boolean {
  if (durationMs > maxDurationMs) return true;
  if (estimateWavSize(durationMs, sampleRate, channels) > maxFileSizeBytes) return true;
  return false;
}

/**
 * Compute the maximum chunk duration in seconds given size and duration constraints.
 */
function computeMaxChunkSec(
  maxDurationMs: number,
  maxFileSizeBytes: number,
  sampleRate: number,
  channels: number,
): number {
  const maxDurationSec = maxDurationMs / 1000;
  const maxDurationForSizeSec = (maxFileSizeBytes - 44) / (sampleRate * channels * 2);
  return Math.min(maxDurationSec, maxDurationForSizeSec);
}

/**
 * Group speech segments into chunks that respect size and duration limits.
 *
 * @param speechSegments - Merged speech segments sorted by start time
 * @param pcmSamples - Full audio as Float32Array
 * @param options - Chunker options
 * @returns Array of AudioChunk objects
 */
export function groupIntoChunks(
  speechSegments: SpeechSegment[],
  pcmSamples: Float32Array,
  options: ChunkerOptions,
): AudioChunk[] {
  const {
    maxFileSizeBytes,
    maxDurationMs,
    overlapMs,
    format,
    sampleRate,
    channels,
  } = options;

  const totalDurationSec = pcmSamples.length / sampleRate;
  const totalDurationMs = totalDurationSec * 1000;
  const overlapSec = overlapMs / 1000;
  const maxChunkSec = computeMaxChunkSec(maxDurationMs, maxFileSizeBytes, sampleRate, channels);

  // Handle no speech: return entire audio as one chunk
  if (speechSegments.length === 0) {
    const data = encodeWav(pcmSamples, sampleRate, channels);
    return [
      {
        index: 0,
        startMs: 0,
        endMs: totalDurationMs,
        durationMs: totalDurationMs,
        data,
        format,
        sizeBytes: data.length,
        overlapMs: 0,
        noSpeechDetected: true,
      },
    ];
  }

  const chunks: AudioChunk[] = [];
  let currentStartSec = 0;
  let segIdx = 0;

  while (segIdx < speechSegments.length) {
    const seg = speechSegments[segIdx];

    // Check if the current segment itself (from currentStartSec to seg.end)
    // exceeds limits -- if so, force-split
    const segDurationMs = (seg.end - currentStartSec) * 1000;
    if (exceedsLimits(segDurationMs, maxDurationMs, maxFileSizeBytes, sampleRate, channels)) {
      // Force-split: emit a chunk of maxChunkSec duration
      const chunkEndSec = Math.min(currentStartSec + maxChunkSec, totalDurationSec);
      const nextStartSec = Math.max(currentStartSec + 0.001, chunkEndSec - overlapSec);

      const chk = extractChunk(
        pcmSamples,
        currentStartSec,
        chunkEndSec,
        sampleRate,
        channels,
        format,
        chunks.length,
        chunks.length > 0 ? overlapMs : 0,
        true,
      );
      chunks.push(chk);
      currentStartSec = nextStartSec;

      // If the segment ends beyond our split, don't advance segIdx
      if (seg.end > chunkEndSec + 0.001) {
        continue;
      }
      // Otherwise, the segment fits now; advance
      segIdx++;
      continue;
    }

    // Try to accumulate more segments into this chunk
    let endSegIdx = segIdx;

    while (endSegIdx + 1 < speechSegments.length) {
      const nextSeg = speechSegments[endSegIdx + 1];
      const candidateDurationMs = (nextSeg.end - currentStartSec) * 1000;

      if (exceedsLimits(candidateDurationMs, maxDurationMs, maxFileSizeBytes, sampleRate, channels)) {
        break;
      }

      endSegIdx++;
    }

    // Determine chunk boundary
    const lastIncludedSeg = speechSegments[endSegIdx];
    let actualEndSec: number;
    let nextStartSec: number;

    if (endSegIdx + 1 < speechSegments.length) {
      // There are more segments after this chunk -- split at the gap
      const gapLeftEnd = lastIncludedSeg.end;
      const gapRightStart = speechSegments[endSegIdx + 1].start;
      const gapDuration = gapRightStart - gapLeftEnd;

      if (gapDuration > 0) {
        let halfOverlap = Math.min(overlapSec / 2, gapDuration / 2);

        // Check if adding overlap would exceed limits; if so, reduce overlap
        let candidateEndSec = gapLeftEnd + halfOverlap;
        let candidateDurationMs = (candidateEndSec - currentStartSec) * 1000;
        while (
          halfOverlap > 0.001 &&
          exceedsLimits(candidateDurationMs, maxDurationMs, maxFileSizeBytes, sampleRate, channels)
        ) {
          halfOverlap = halfOverlap / 2;
          candidateEndSec = gapLeftEnd + halfOverlap;
          candidateDurationMs = (candidateEndSec - currentStartSec) * 1000;
        }

        // If it still exceeds limits even without overlap, use the speech end directly
        if (exceedsLimits(candidateDurationMs, maxDurationMs, maxFileSizeBytes, sampleRate, channels)) {
          actualEndSec = gapLeftEnd;
          nextStartSec = gapRightStart;
        } else {
          actualEndSec = candidateEndSec;
          nextStartSec = gapRightStart - halfOverlap;
        }
      } else {
        actualEndSec = lastIncludedSeg.end;
        nextStartSec = lastIncludedSeg.end;
      }
    } else {
      // This is the last group
      actualEndSec = lastIncludedSeg.end;
      nextStartSec = lastIncludedSeg.end;
    }

    // Clamp to total duration
    if (actualEndSec > totalDurationSec) {
      actualEndSec = totalDurationSec;
    }

    const chk = extractChunk(
      pcmSamples,
      currentStartSec,
      actualEndSec,
      sampleRate,
      channels,
      format,
      chunks.length,
      chunks.length > 0 ? overlapMs : 0,
      false,
    );
    chunks.push(chk);

    currentStartSec = nextStartSec;
    segIdx = endSegIdx + 1;
  }

  return chunks;
}

/**
 * Extract a chunk of audio, encode it, and build the AudioChunk object.
 */
function extractChunk(
  pcmSamples: Float32Array,
  startSec: number,
  endSec: number,
  sampleRate: number,
  channels: number,
  format: AudioFormat,
  index: number,
  overlapMs: number,
  forceSplit: boolean,
): AudioChunk {
  const startSample = Math.max(0, Math.floor(startSec * sampleRate));
  const endSample = Math.min(pcmSamples.length, Math.floor(endSec * sampleRate));

  const chunkSamples = pcmSamples.slice(startSample, endSample);
  const data = encodeWav(chunkSamples, sampleRate, channels);

  const startMs = startSec * 1000;
  const endMs = endSec * 1000;

  return {
    index,
    startMs,
    endMs,
    durationMs: endMs - startMs,
    data,
    format,
    sizeBytes: data.length,
    overlapMs,
    ...(forceSplit ? { forceSplit: true } : {}),
  };
}
