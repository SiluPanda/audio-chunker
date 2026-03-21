/**
 * A single audio chunk extracted from a larger recording.
 * Each chunk is a valid audio segment ready for transcription API submission.
 */
export interface AudioChunk {
  /** Zero-based index of this chunk in the result array. */
  index: number;

  /** Start time of this chunk in milliseconds from the beginning of the source audio. */
  startMs: number;

  /** End time of this chunk in milliseconds from the beginning of the source audio. */
  endMs: number;

  /** Duration of this chunk in milliseconds. */
  durationMs: number;

  /** Encoded audio data for this chunk. */
  data: Buffer;

  /** Output format of this chunk. */
  format: AudioFormat;

  /** Size of the encoded audio data in bytes. */
  sizeBytes: number;

  /** Duration of overlap at the start of this chunk in milliseconds.
   *  Audio from this region also appears at the end of the previous chunk.
   *  Zero for the first chunk. */
  overlapMs: number;

  /** Whether this chunk was force-split (no silence boundary found). */
  forceSplit?: boolean;

  /** Whether no speech was detected in this chunk. */
  noSpeechDetected?: boolean;
}

/** Supported output audio formats. */
export type AudioFormat = 'wav';

/**
 * Options for the chunk() function.
 */
export interface ChunkOptions {
  /** Maximum duration per chunk in milliseconds. Default: Infinity (no limit). */
  maxDurationMs?: number;

  /** Maximum file size per chunk. Accepts a number (bytes) or string like '25mb', '10MB', '1gb'.
   *  Default: '25mb'. */
  maxFileSize?: string | number;

  /** Overlap duration in milliseconds at chunk boundaries. Default: 1000 (1 second). */
  overlapMs?: number;

  /** Minimum silence duration in milliseconds to qualify as a split point. Default: 500. */
  minSilenceMs?: number;

  /** Output audio format. Default: 'wav'. */
  format?: AudioFormat;

  /** Target sample rate in Hz. Default: 16000. */
  sampleRate?: number;

  /** Number of audio channels. Default: 1 (mono). */
  channels?: number;

  /** Minimum speech duration in milliseconds. Segments shorter than this are discarded. Default: 250. */
  minSpeechMs?: number;

  /** RMS energy threshold for the energy-based VAD (0.0 - 1.0). Default: 0.01. */
  energyThreshold?: number;

  /** Custom VAD function. If provided, overrides the built-in energy-based VAD. */
  vad?: VadFunction;
}

/** Audio source: a Buffer containing audio data. */
export type AudioSource = Buffer;

/**
 * A VAD (Voice Activity Detection) segment describing a contiguous region
 * of speech or silence in the audio.
 */
export interface VADSegment {
  /** Start time in milliseconds. */
  startMs: number;

  /** End time in milliseconds. */
  endMs: number;

  /** Whether this segment is speech or silence. */
  type: 'speech' | 'silence';
}

/**
 * Result of the chunk() function.
 */
export interface ChunkResult {
  /** Array of audio chunks. */
  chunks: AudioChunk[];

  /** Total duration of the source audio in milliseconds. */
  totalDurationMs: number;

  /** Detected format of the source audio. */
  sourceFormat: string;
}

/**
 * Parsed WAV file metadata.
 */
export interface WavInfo {
  /** Sample rate in Hz. */
  sampleRate: number;

  /** Number of channels. */
  channels: number;

  /** Bits per sample. */
  bitDepth: number;

  /** Byte offset where PCM data begins. */
  dataOffset: number;

  /** Size of the PCM data in bytes. */
  dataSize: number;

  /** Duration of the audio in milliseconds. */
  durationMs: number;

  /** Audio format code (1 = PCM). */
  audioFormat: number;

  /** Block align (bytes per frame). */
  blockAlign: number;

  /** Byte rate. */
  byteRate: number;
}

/**
 * A speech segment detected by VAD, with start and end times in seconds.
 */
export interface SpeechSegment {
  /** Start time in seconds. */
  start: number;

  /** End time in seconds. */
  end: number;
}

/**
 * A VAD function that accepts audio samples and returns speech segments.
 */
export type VadFunction = (
  audio: Float32Array,
  sampleRate: number,
) => Promise<SpeechSegment[]>;
