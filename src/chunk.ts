import {
  AudioSource,
  ChunkOptions,
  ChunkResult,
  SpeechSegment,
  VADSegment,
} from './types';
import { parseSize } from './size';
import { parseWav, extractPcmFloat32, resample, detectFormat } from './wav';
import { detectSpeech, toVadSegments, EnergyVadOptions } from './vad';
import { groupIntoChunks } from './chunker';

const DEFAULT_MAX_FILE_SIZE = '25mb';
const DEFAULT_OVERLAP_MS = 1000;
const DEFAULT_MIN_SILENCE_MS = 500;
const DEFAULT_MIN_SPEECH_MS = 250;
const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_CHANNELS = 1;
const DEFAULT_ENERGY_THRESHOLD = 0.01;

/**
 * Split audio into transcription-ready chunks using voice activity detection.
 *
 * Accepts a Buffer containing audio data (WAV format), runs VAD to identify
 * speech and silence boundaries, splits at silence gaps, and returns chunks
 * that respect file size and duration limits.
 *
 * @param source - Buffer containing audio data
 * @param options - Chunking options
 * @returns ChunkResult containing an array of AudioChunks
 *
 * @example
 * ```typescript
 * import { chunk } from 'audio-chunker';
 * import { readFileSync } from 'fs';
 *
 * const audio = readFileSync('./recording.wav');
 * const result = await chunk(audio, { maxFileSize: '25mb' });
 *
 * for (const c of result.chunks) {
 *   console.log(`Chunk ${c.index}: ${c.startMs}ms - ${c.endMs}ms (${c.sizeBytes} bytes)`);
 * }
 * ```
 */
export async function chunk(
  source: AudioSource,
  options: ChunkOptions = {},
): Promise<ChunkResult> {
  // Parse and validate options
  const maxFileSizeBytes = parseSize(options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE);
  const maxDurationMs = options.maxDurationMs ?? Infinity;
  const overlapMs = options.overlapMs ?? DEFAULT_OVERLAP_MS;
  const minSilenceMs = options.minSilenceMs ?? DEFAULT_MIN_SILENCE_MS;
  const minSpeechMs = options.minSpeechMs ?? DEFAULT_MIN_SPEECH_MS;
  const format = options.format ?? 'wav';
  const targetSampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const targetChannels = options.channels ?? DEFAULT_CHANNELS;
  const energyThreshold = options.energyThreshold ?? DEFAULT_ENERGY_THRESHOLD;
  const customVad = options.vad;

  if (!Buffer.isBuffer(source)) {
    throw new Error('Source must be a Buffer containing audio data.');
  }

  if (source.length === 0) {
    return {
      chunks: [],
      totalDurationMs: 0,
      sourceFormat: 'unknown',
    };
  }

  // Detect source format
  const sourceFormat = detectFormat(source);

  // Decode audio to PCM
  let pcmSamples: Float32Array;
  let sourceSampleRate: number;

  if (sourceFormat === 'wav') {
    const wavInfo = parseWav(source);
    pcmSamples = extractPcmFloat32(source, wavInfo);
    sourceSampleRate = wavInfo.sampleRate;
  } else {
    // For unknown formats, try to treat as raw PCM at the target sample rate
    // This is a fallback -- in production, ffmpeg would handle format conversion
    throw new Error(
      `Unsupported audio format: "${sourceFormat}". Only WAV format is supported without ffmpeg.`,
    );
  }

  // Resample to target sample rate
  pcmSamples = resample(pcmSamples, sourceSampleRate, targetSampleRate);

  const totalDurationMs = (pcmSamples.length / targetSampleRate) * 1000;

  // Run VAD
  let speechSegments: SpeechSegment[];

  if (customVad) {
    speechSegments = await customVad(pcmSamples, targetSampleRate);
  } else {
    const vadOptions: EnergyVadOptions = {
      energyThreshold,
      minSilenceMs,
      minSpeechMs,
    };
    speechSegments = await detectSpeech(pcmSamples, targetSampleRate, vadOptions);
  }

  // Group segments into chunks
  const chunks = groupIntoChunks(speechSegments, pcmSamples, {
    maxFileSizeBytes,
    maxDurationMs,
    overlapMs,
    format,
    sampleRate: targetSampleRate,
    channels: targetChannels,
  });

  return {
    chunks,
    totalDurationMs,
    sourceFormat,
  };
}

/**
 * Run voice activity detection on audio and return VAD segments.
 *
 * @param source - Buffer containing WAV audio data
 * @param options - Detection options
 * @returns Promise resolving to an array of VADSegment objects
 */
export async function detectSpeechSegments(
  source: AudioSource,
  options: ChunkOptions = {},
): Promise<VADSegment[]> {
  const targetSampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const minSilenceMs = options.minSilenceMs ?? DEFAULT_MIN_SILENCE_MS;
  const minSpeechMs = options.minSpeechMs ?? DEFAULT_MIN_SPEECH_MS;
  const energyThreshold = options.energyThreshold ?? DEFAULT_ENERGY_THRESHOLD;
  const customVad = options.vad;

  if (!Buffer.isBuffer(source)) {
    throw new Error('Source must be a Buffer containing audio data.');
  }

  if (source.length === 0) {
    return [];
  }

  const sourceFormat = detectFormat(source);

  let pcmSamples: Float32Array;
  let sourceSampleRate: number;

  if (sourceFormat === 'wav') {
    const wavInfo = parseWav(source);
    pcmSamples = extractPcmFloat32(source, wavInfo);
    sourceSampleRate = wavInfo.sampleRate;
  } else {
    throw new Error(
      `Unsupported audio format: "${sourceFormat}". Only WAV format is supported without ffmpeg.`,
    );
  }

  pcmSamples = resample(pcmSamples, sourceSampleRate, targetSampleRate);
  const totalDurationMs = (pcmSamples.length / targetSampleRate) * 1000;

  let speechSegments: SpeechSegment[];

  if (customVad) {
    speechSegments = await customVad(pcmSamples, targetSampleRate);
  } else {
    speechSegments = await detectSpeech(pcmSamples, targetSampleRate, {
      energyThreshold,
      minSilenceMs,
      minSpeechMs,
    });
  }

  return toVadSegments(speechSegments, totalDurationMs);
}
