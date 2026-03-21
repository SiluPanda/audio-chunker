// audio-chunker - Chunk audio streams into transcription-ready segments

// Main API
export { chunk, detectSpeechSegments } from './chunk';

// WAV utilities
export { parseWav, extractPcmFloat32, resample, encodeWav, detectFormat } from './wav';

// VAD
export { detectSpeech } from './vad';

// Size utilities
export { parseSize, estimateWavSize } from './size';

// Types
export type {
  AudioChunk,
  AudioFormat,
  ChunkOptions,
  AudioSource,
  VADSegment,
  ChunkResult,
  WavInfo,
  SpeechSegment,
  VadFunction,
} from './types';
