# audio-chunker — Task Breakdown

## Phase 1: Project Setup and Scaffolding

- [ ] **Set up project dependencies** — Install runtime dependencies (`fluent-ffmpeg`), dev dependencies (`typescript`, `vitest`, `eslint`, `@types/node`, `@types/fluent-ffmpeg`), and configure peer dependencies (`@ricky0123/vad-node` as optional). Update `package.json` with all dependency entries, peer dependency metadata, and the `bin` field for the CLI (`audio-chunker`). | Status: not_done

- [x] **Configure ESLint** — Add ESLint configuration for TypeScript. Follow existing monorepo patterns if available. Ensure `npm run lint` works against `src/`. | Status: done

- [ ] **Create directory structure** — Create all directories specified in the file structure: `src/vad/`, `src/audio/`, `src/chunking/`, `src/util/`, `src/__tests__/`, `src/__tests__/vad/`, `src/__tests__/audio/`, `src/__tests__/chunking/`, `src/__tests__/util/`, `src/__tests__/fixtures/`. | Status: not_done

## Phase 2: Type Definitions

- [ ] **Define core types in `src/types.ts`** — Define all TypeScript types and interfaces: `AudioSource`, `SpeechSegment`, `VadFunction`, `SileroVadOptions`, `EnergyVadOptions`, `OutputFormat`, `RawPcmFormat`, `AudioChunk` (with `buffer`, `format`, `index`, `startTime`, `endTime`, `duration`, `sampleRate`, `channels`, `byteLength`, `speechSegmentCount`, `overlap: { before, after }`, `forceSplit`, `noSpeechDetected`), `ChunkOptions`, `VadOnlyOptions`, `ChunkerConfig`, and `AudioChunker` interface (with `write`, `end`, `on`, `off`, `processedDuration`, `chunkCount`). | Status: not_done

- [ ] **Define VAD-specific types in `src/vad/types.ts`** — Define the `VadFunction` type and `SpeechSegment` interface for use within the VAD module. Re-export or share with `src/types.ts` as appropriate. | Status: not_done

## Phase 3: Utility Modules

- [x] **Implement size string parser in `src/util/size-parser.ts`** — Parse human-readable size strings (`'25mb'`, `'10mb'`, `'1gb'`, `'500kb'`) to byte values. Support case-insensitive matching. Pass through numeric values as-is (interpreted as bytes). Support `kb`, `mb`, `gb` units using binary (1024-based) interpretation: `1kb` = 1024, `1mb` = 1048576, `1gb` = 1073741824. | Status: done

- [ ] **Implement time/sample offset utilities in `src/util/time.ts`** — Provide helper functions to convert between time (seconds) and sample offsets given a sample rate. For example: `timeToSamples(seconds, sampleRate)` and `samplesToTime(sampleCount, sampleRate)`. | Status: not_done

## Phase 4: Audio I/O — WAV Parser

- [x] **Implement WAV file parser in `src/audio/wav-parser.ts`** — Parse RIFF/WAVE headers, read `fmt ` chunk (audio format, channels, sample rate, bits per sample), read `data` chunk. Extract PCM samples as `Float32Array` with values in [-1.0, 1.0]. Support 8-bit unsigned, 16-bit signed, 24-bit signed, and 32-bit float PCM formats. Handle mono and stereo. | Status: done

- [x] **WAV parser: header validation** — Validate magic bytes (`RIFF` at offset 0, `WAVE` at offset 8). Validate `fmt ` chunk presence and minimum size. Reject files with invalid magic bytes, truncated headers, or unsupported PCM encodings (e.g., A-law, mu-law). Throw `InvalidAudioError` with descriptive messages. | Status: done

- [x] **WAV parser: metadata extraction** — Extract and return sample count, duration, channel count, sample rate, and bit depth from the WAV header without decoding the full PCM data. | Status: done

## Phase 5: Audio I/O — WAV Writer

- [x] **Implement WAV file writer in `src/audio/wav-writer.ts`** — Encode `Float32Array` samples ([-1.0, 1.0]) to a valid 16-bit PCM WAV file as a `Buffer`. Write correct RIFF/WAVE header with proper chunk sizes: `fmt ` chunk (PCM format code 1, channel count, sample rate, byte rate, block align, bits per sample = 16) and `data` chunk. Convert Float32 samples to Int16 (clamp to [-32768, 32767]). | Status: done

## Phase 6: Audio I/O — Resampler and Channel Mixer

- [x] **Implement sample rate converter in `src/audio/resampler.ts`** — Resample audio from any input sample rate to a target sample rate. Use linear interpolation for the initial implementation. Accept `Float32Array` input and return `Float32Array` output. Handle upsampling and downsampling. | Status: done

- [x] **Implement channel mixer in `src/audio/channel-mixer.ts`** — Convert multi-channel audio to mono by averaging all channels. Accept interleaved `Float32Array` samples with a specified channel count, return mono `Float32Array`. Handle the identity case (mono input returns as-is). | Status: done

## Phase 7: Audio I/O — Format Detection and ffmpeg Integration

- [ ] **Implement format detection in `src/audio/format-detect.ts`** — Detect audio format from magic bytes (first 4-12 bytes of file/buffer). Support: WAV (`RIFF` + `WAVE`), MP3 (ID3 tag `ID3` or MPEG sync word `0xFF 0xFB/0xF3/0xF2`), FLAC (`fLaC`), OGG (`OggS`), WebM (EBML header `0x1A45DFA3`), M4A/AAC (`ftyp`). Return the detected format string or `'unknown'`. Do not rely on file extensions. | Status: not_done

- [ ] **Implement audio decoder in `src/audio/decoder.ts`** — Orchestrate audio decoding. For WAV input, use the built-in WAV parser. For non-WAV formats, decode via `fluent-ffmpeg` by spawning an `ffmpeg` process that outputs raw PCM (Float32LE or Int16LE). Apply resampling and channel mixing to produce normalized mono Float32Array at the target sample rate. Accept file paths, Buffers, and Uint8Arrays as input. | Status: not_done

- [ ] **Implement audio encoder in `src/audio/encoder.ts`** — Encode Float32Array PCM samples to the target output format. For WAV, use the built-in WAV writer. For MP3, FLAC, and OGG/Opus, encode via `ffmpeg` (pipe PCM to stdin, read encoded output from stdout). Support the `mp3Bitrate` option for MP3 output. | Status: not_done

- [ ] **Implement ffmpeg availability check** — Create a utility to check whether `ffmpeg` is available on the system PATH. Cache the result. When `ffmpeg` is required but not found, throw `FfmpegNotFoundError` with a message explaining how to install `ffmpeg`. | Status: not_done

- [ ] **Implement audio I/O orchestration in `src/audio/index.ts`** — Provide a high-level `decodeAudio(source, options)` function that handles format detection, decoder selection (built-in WAV vs. ffmpeg), resampling, and channel mixing. Provide an `encodeAudio(samples, format, options)` function for encoding. Handle the `RawPcmFormat` input descriptor for raw PCM buffers. | Status: not_done

## Phase 8: Voice Activity Detection — Energy VAD

- [x] **Implement energy-based VAD in `src/vad/energy.ts`** — Implement RMS energy-based speech detection. Process audio in 30ms frames with 15ms hop. Calculate RMS energy per frame: `rms = sqrt(mean(samples^2))`. Classify frames with RMS above threshold (default 0.01) as speech, others as silence. Return array of `SpeechSegment` objects. | Status: done

- [x] **Energy VAD: segment merging** — After frame classification, merge adjacent speech frames into contiguous speech segments. Merge segments separated by silence gaps shorter than `minSilenceDurationMs` (default 500ms). Discard speech segments shorter than `minSpeechDurationMs` (default 250ms). | Status: done

- [x] **Energy VAD: configuration** — Support `EnergyVadOptions`: `threshold` (default 0.01), `frameSizeMs` (default 30), `hopSizeMs` (default 15). Accept these via the options interface. | Status: done

## Phase 9: Voice Activity Detection — Silero VAD Adapter

- [ ] **Implement Silero VAD adapter in `src/vad/silero.ts`** — Wrap `@ricky0123/vad-node` to implement the `VadFunction` interface. Dynamically import `@ricky0123/vad-node` to handle the optional peer dependency gracefully. If the import fails, throw an error indicating the package needs to be installed. Resample input to 16kHz if needed (Silero operates on 16kHz). Process audio in 30ms frames (480 samples at 16kHz). | Status: not_done

- [ ] **Silero VAD: configuration** — Support `SileroVadOptions`: `threshold` (default 0.5), `minSilenceDurationMs` (default 500), `minSpeechDurationMs` (default 250), `speechPadMs` (default 100). Apply speech padding to extend segment boundaries. | Status: not_done

- [ ] **Silero VAD: model caching** — Cache the ONNX model after first load to avoid the ~500ms loading cost on subsequent invocations. | Status: not_done

## Phase 10: VAD Adapter Selection

- [ ] **Implement VAD dispatch in `src/vad/index.ts`** — Implement VAD adapter selection logic. If `vad` option is `'silero'`, use Silero adapter. If `'energy'`, use energy VAD. If a custom `VadFunction` is provided, use it directly. If no `vad` option is specified, attempt to load Silero (try dynamic import of `@ricky0123/vad-node`); if it fails, fall back to energy VAD and emit a warning via `console.warn`. | Status: not_done

- [x] **Implement VAD segment merging utility** — Implement the segment merging algorithm as a shared utility used by both VAD adapters and the main chunking pipeline. Sort segments by start time, merge segments separated by gaps shorter than `minSilenceDuration`, discard segments shorter than `minSpeechDuration`. Handle edge cases: empty input, single segment, overlapping segments. | Status: done

## Phase 11: Chunking Algorithm — Split Points

- [x] **Implement split point identification in `src/chunking/split-points.ts`** — Given an array of merged speech segments, identify all silence gaps between consecutive segments as candidate split points. Each candidate carries: position (midpoint of the gap), gap duration, left segment end time, and right segment start time. Sort candidates by preference: longer silence gaps first, then by proximity to ideal chunk duration boundaries. | Status: done

## Phase 12: Chunking Algorithm — Size Estimation

- [ ] **Implement size estimator in `src/chunking/size-estimator.ts`** — Estimate the encoded file size for a given audio duration, output format, sample rate, and channel count. WAV: `44 + (duration * sampleRate * channels * 2)`. MP3: `(bitrate / 8) * duration`. FLAC: `duration * sampleRate * channels * 2 * compressionRatio` (use conservative ratio ~0.7). OGG/Opus: `(bitrate / 8) * duration` (use 32kbps default for speech). | Status: not_done

- [ ] **Size estimator: post-encoding verification** — After encoding a chunk, compare actual byte length to estimated size. If the actual size exceeds `maxFileSize`, trigger re-splitting. Return a flag or status indicating whether the chunk needs re-splitting. | Status: not_done

## Phase 13: Chunking Algorithm — Segment Grouping

- [x] **Implement segment grouper in `src/chunking/grouper.ts`** — Implement the core grouping algorithm: accumulate speech segments into the current chunk, estimate encoded size after adding each segment, split at the best candidate split point when limits would be exceeded. Handle the `maxFileSize` and `maxDuration` constraints, applying whichever is more restrictive. | Status: done

- [x] **Segment grouper: force-split fallback** — When no silence gap is found within the current chunk (continuous speech), progressively reduce `minSilenceDuration` (halving it) to find finer gaps. As a last resort, force-split at the `maxDuration` limit. Mark force-split chunks with `forceSplit: true`. | Status: done

- [ ] **Segment grouper: very long silence handling** — When a silence gap is very long (several minutes), split the silence at its midpoint. Assign the first half to the preceding chunk and the second half to the following chunk, preventing one chunk from containing excessive silence. | Status: not_done

## Phase 14: Chunking Algorithm — Overlap

- [x] **Implement overlap logic in `src/chunking/overlap.ts`** — Apply overlap at chunk boundaries. Extend chunk N's end by `overlapDuration / 2` and chunk N+1's start earlier by `overlapDuration / 2`, centered on the split point (midpoint of the silence gap). Cap overlap to not extend beyond silence gap boundaries (never duplicate from within speech segments). First chunk has no start overlap, last chunk has no end overlap. | Status: done

- [x] **Overlap: zero overlap mode** — When `overlapDuration` is 0, produce non-overlapping chunks with no boundary duplication. Ensure `overlap.before` and `overlap.after` are both 0 for all chunks. | Status: done

## Phase 15: Chunking Algorithm — Orchestration

- [x] **Implement chunking orchestration in `src/chunking/index.ts`** — Wire together split point identification, segment grouping, overlap application, and audio extraction. Accept merged speech segments and normalized PCM audio, produce an array of chunk definitions (start/end times, segment counts, overlap info, force-split flags). | Status: done

## Phase 16: Iterative Re-Splitting

- [ ] **Implement iterative re-splitting** — After encoding a chunk, if its actual byte size exceeds `maxFileSize` (due to inaccurate compression ratio estimation for lossy formats), re-split the oversized chunk: find the silence gap closest to the midpoint, split into two sub-chunks, encode each, and recurse if either still exceeds the limit. Ensure all output chunks fit within the size limit. | Status: not_done

## Phase 17: Core API — `chunk()` Function

- [x] **Implement `chunk()` function in `src/chunk.ts`** — Orchestrate the full chunking pipeline: (1) Accept `AudioSource` (file path, Buffer, Uint8Array) and `ChunkOptions`. (2) Decode and normalize audio to mono Float32Array at target sample rate. (3) Run VAD to detect speech segments. (4) Merge segments (minSilenceDuration, minSpeechDuration filtering). (5) Identify split points. (6) Group segments into chunks respecting size/duration limits. (7) Apply overlap. (8) Extract PCM samples for each chunk. (9) Encode each chunk to the target format. (10) Build and return `AudioChunk[]` with full metadata. | Status: done

- [x] **`chunk()`: handle no speech detected** — When VAD detects no speech in the entire audio, return a single chunk containing the full audio with `noSpeechDetected: true` in the metadata. | Status: done

- [x] **`chunk()`: handle empty audio** — When the input audio is empty (zero-length file or buffer), return an empty array with no chunks. | Status: done

- [ ] **`chunk()`: AbortSignal support** — Respect the `signal` option for cancellation. Check the signal at key processing points (before VAD, before encoding each chunk). Throw `AbortError` if the signal is aborted. | Status: not_done

- [x] **`chunk()`: default option values** — Apply all default values from the spec: `maxFileSize: '25mb'`, `maxDuration: Infinity`, `overlapDuration: 1.0`, `outputFormat: 'wav'`, `sampleRate: 16000`, `channels: 1`, `minSilenceDuration: 500`, `minSpeechDuration: 250`, `mp3Bitrate: 64`. | Status: done

## Phase 18: Core API — `detectSpeechSegments()` Function

- [x] **Implement `detectSpeechSegments()` in `src/detect.ts`** — Accept `AudioSource` and `VadOnlyOptions`. Decode and normalize the audio. Run VAD. Apply segment merging (minSilenceDuration, minSpeechDuration). Return `SpeechSegment[]` with start and end times. Do not perform any chunking or encoding. | Status: done

## Phase 19: Core API — Public Exports

- [ ] **Wire up public API exports in `src/index.ts`** — Export `chunk`, `detectSpeechSegments`, and `createChunker` as named exports. Export all public types: `AudioSource`, `SpeechSegment`, `VadFunction`, `AudioChunk`, `ChunkOptions`, `VadOnlyOptions`, `ChunkerConfig`, `AudioChunker`, `OutputFormat`, `RawPcmFormat`, `SileroVadOptions`, `EnergyVadOptions`. | Status: not_done

## Phase 20: Streaming Mode — `createChunker()` Factory

- [ ] **Implement `createChunker()` in `src/factory.ts`** — Create a factory function that returns an `AudioChunker` instance. The instance is an `EventEmitter` that supports `'chunk'`, `'end'`, and `'error'` events. Accept `ChunkerConfig` which extends `ChunkOptions` and requires `inputFormat: RawPcmFormat`. | Status: not_done

- [ ] **Streaming chunker: `write()` method** — Accept `Buffer` or `Uint8Array` audio data. Decode raw PCM input according to `inputFormat` (encoding, sample rate, channels). Resample to target sample rate. Convert to mono. Append to internal sample buffer. | Status: not_done

- [ ] **Streaming chunker: incremental VAD** — As audio accumulates, run VAD on new audio at configurable analysis window intervals (default 1 second). Update the internal speech/silence timeline incrementally without reprocessing the entire history. | Status: not_done

- [ ] **Streaming chunker: chunk emission** — Emit a `'chunk'` event when: (a) a silence gap of sufficient duration is detected after enough audio has accumulated, (b) accumulated audio would exceed `maxDuration`, or (c) estimated file size would exceed `maxFileSize`. Encode the chunk to the target format before emitting. Include full `AudioChunk` metadata. | Status: not_done

- [ ] **Streaming chunker: look-ahead confirmation** — Do not emit a chunk at a silence gap until at least one additional analysis window of audio has been received beyond the gap. This prevents premature splitting at brief pauses that are not true speech boundaries. | Status: not_done

- [ ] **Streaming chunker: `end()` method** — Flush remaining buffered audio as a final chunk. Emit the `'end'` event after the final chunk. Handle the case where no audio has been written (no chunk emitted, just emit `'end'`). | Status: not_done

- [ ] **Streaming chunker: `processedDuration` and `chunkCount` properties** — Track and expose `processedDuration` (total seconds of audio written) and `chunkCount` (number of chunks emitted so far) as read-only properties. | Status: not_done

- [ ] **Streaming chunker: error handling** — Emit `'error'` event for invalid input format, decode failures, or encoding failures. Do not throw synchronously from `write()` — use the error event. | Status: not_done

## Phase 21: Error Handling

- [ ] **Define custom error classes** — Create `InvalidAudioError` (invalid/corrupted audio file), `FfmpegNotFoundError` (ffmpeg not installed but required), `UnsupportedFormatError` (format not supported without ffmpeg). Include descriptive error messages with guidance (e.g., how to install ffmpeg). | Status: not_done

- [ ] **Error: file not found** — When `chunk()` or `detectSpeechSegments()` receives a file path that does not exist, throw an error with a clear message including the path. | Status: not_done

- [ ] **Error: non-audio file** — When format detection cannot identify the input as a supported audio format (e.g., a text file with a `.wav` extension), throw `InvalidAudioError` with a descriptive message. | Status: not_done

- [ ] **Error: corrupted WAV header** — When the WAV parser encounters a truncated or malformed header, throw `InvalidAudioError` with details about what was wrong (e.g., "WAV header truncated: expected 44 bytes, got 20"). | Status: not_done

- [ ] **Error: non-WAV input without ffmpeg** — When the input format requires ffmpeg for decoding but ffmpeg is not available, throw `FfmpegNotFoundError` with installation instructions. | Status: not_done

- [ ] **Error: non-WAV output without ffmpeg** — When the output format (MP3, FLAC, OGG) requires ffmpeg for encoding but ffmpeg is not available, throw `FfmpegNotFoundError`. | Status: not_done

## Phase 22: CLI Implementation

- [ ] **Implement CLI entry point in `src/cli.ts`** — Parse command-line arguments. Support two commands: `chunk` and `detect`. Register the binary name `audio-chunker` in `package.json` via the `bin` field. Add the `#!/usr/bin/env node` shebang. | Status: not_done

- [ ] **CLI `chunk` command** — Implement `audio-chunker chunk <file> [options]`. Accept all chunking options as CLI flags: `--max-size`, `--max-duration`, `--overlap`, `--min-silence`, `--output-dir` (default `./chunks`), `--format`, `--sample-rate`, `--json`, `--vad`, `--vad-threshold`. Write chunk files to the output directory (create if needed). Name files `chunk-000.wav`, `chunk-001.wav`, etc. | Status: not_done

- [ ] **CLI `chunk` command: human-readable output** — Display a formatted summary: input file info (name, duration, sample rate, channels, size), VAD type and threshold, output format and settings, per-chunk table (index, time range, duration, size, segment count), total chunk count and output directory. Match the format shown in spec section 14. | Status: not_done

- [ ] **CLI `chunk` command: JSON output** — When `--json` flag is set, output chunk metadata as JSON to stdout instead of writing files. Include all metadata fields plus a `file` field with the relative path that would have been written. | Status: not_done

- [ ] **CLI `detect` command** — Implement `audio-chunker detect <file> [options]`. Accept options: `--vad`, `--vad-threshold`, `--min-silence`, `--format` (`text` or `json`). In text format, output one line per segment: `START - END (speech)`. In JSON format, output the array of speech segments. | Status: not_done

- [ ] **CLI: `--version` flag** — Print the package version (from `package.json`) and exit with code 0. | Status: not_done

- [ ] **CLI: `--help` flag** — Print usage instructions for the requested command (or general help) and exit with code 0. | Status: not_done

- [ ] **CLI: exit codes** — Exit with code 0 on success, code 1 on processing errors (file not found, decode failure), code 2 on configuration errors (invalid flags, missing arguments, unsupported format). | Status: not_done

- [ ] **CLI: argument validation** — Validate all CLI arguments. Reject unknown flags, missing required arguments, invalid format values, and non-numeric values where numbers are expected. Print descriptive error messages for each case. | Status: not_done

## Phase 23: Unit Tests — Utilities

- [x] **Test size string parser** — Test `'25mb'` -> 26214400, `'10mb'` -> 10485760, `'1gb'` -> 1073741824, `'500kb'` -> 512000. Test case-insensitivity (`'25MB'`, `'25Mb'`). Test numeric passthrough. Test invalid inputs (throw error). Write in `src/__tests__/util/size-parser.test.ts`. | Status: done

## Phase 24: Unit Tests — Audio I/O

- [x] **Test WAV parser** — Test parsing valid WAV files with 8-bit, 16-bit, 24-bit, and 32-bit float PCM. Test mono and stereo. Test various sample rates (8kHz, 16kHz, 44.1kHz, 48kHz). Test rejection of invalid WAV files (wrong magic bytes, truncated header, unsupported encoding). Test correct sample count, duration, and channel count extraction. Write in `src/__tests__/audio/wav-parser.test.ts`. | Status: done

- [x] **Test WAV writer** — Test encoding Float32Array to valid 16-bit PCM WAV. Verify header fields (RIFF, WAVE, fmt, data chunk sizes). Test round-trip: decode WAV -> encode WAV -> decode again, verify samples match within 16-bit quantization error. Write in `src/__tests__/audio/wav-writer.test.ts`. | Status: done

- [x] **Test resampler** — Test downsampling (44.1kHz to 16kHz) and upsampling (8kHz to 16kHz). Verify output sample count matches expected count for the target rate. Test identity case (same rate in/out). Write in `src/__tests__/audio/resampler.test.ts`. | Status: done

- [ ] **Test format detection** — Test detection of WAV, MP3, FLAC, OGG, WebM, and M4A from magic bytes. Test unknown format returns `'unknown'`. Test with minimal valid headers. Write in `src/__tests__/audio/format-detect.test.ts`. | Status: not_done

## Phase 25: Unit Tests — VAD

- [x] **Test energy VAD** — Test speech detection in a synthetic sine wave above threshold. Test silence detection in a zero-amplitude signal. Test speech/silence transitions in alternating regions. Test `minSpeechDuration` filtering (discard short segments). Test `minSilenceDuration` merging (merge segments separated by short silence). Test different thresholds produce different segment counts. Write in `src/__tests__/vad/energy.test.ts`. | Status: done

- [x] **Test segment merging** — Test merging two adjacent segments with a short gap. Test keeping segments separate with a long gap. Test overlapping segments merge into one. Test empty input returns empty array. Test single segment returns as-is. Write in a shared test file or within the energy VAD tests. | Status: done

- [ ] **Test Silero VAD adapter** — Test that the adapter loads and processes audio when `@ricky0123/vad-node` is available. Test that it throws a descriptive error when the peer dependency is missing. Test configuration options are passed through correctly. Write in `src/__tests__/vad/silero.test.ts`. | Status: not_done

## Phase 26: Unit Tests — Chunking Algorithm

- [x] **Test split point identification** — Test that silence gaps between speech segments are correctly identified as candidate split points. Test that candidates are sorted by gap duration (longest first). Test edge cases: no gaps (continuous speech), single segment, all segments adjacent. Write in `src/__tests__/chunking/split-points.test.ts`. | Status: done

- [ ] **Test size estimation** — Test WAV size estimation matches actual encoded size within 1% for known duration/rate/channel combinations. Test MP3 estimation is within 20% of actual. Test FLAC estimation is within 30% of actual. Test size string parsing integration. Write in `src/__tests__/chunking/size-estimator.test.ts`. | Status: not_done

- [x] **Test segment grouper** — Test grouping with a single segment that fits in one chunk. Test grouping with multiple segments requiring multiple chunks. Test that no chunk exceeds `maxFileSize`. Test that no chunk exceeds `maxDuration`. Test force-split when no silence gaps exist. Test that the more restrictive of size/duration limits governs. Write in `src/__tests__/chunking/grouper.test.ts`. | Status: done

- [ ] **Test overlap logic** — Test that overlap of 1.0s produces chunks where the last 0.5s of chunk N matches the first 0.5s of chunk N+1. Test first chunk has `overlap.before === 0`. Test last chunk has `overlap.after === 0`. Test overlap of 0.0s produces non-overlapping chunks. Test overlap capping when silence gap is shorter than overlap duration. Write in `src/__tests__/chunking/overlap.test.ts`. | Status: not_done

- [ ] **Test chunk metadata** — Test sequential index starts at 0 and increments. Test `startTime`/`endTime` consistency with `duration`. Test `byteLength` matches `buffer.length`. Test `speechSegmentCount` reflects correct segment count per chunk. Test `forceSplit` is true only when no silence gap was available. | Status: not_done

## Phase 27: Integration Tests — End-to-End Chunking

- [x] **Test end-to-end WAV chunking** — Chunk a known WAV file and verify chunk count, durations, and sizes. Test that a file fitting within size limits produces a single chunk. Test that a file requiring splitting produces multiple chunks all within limits. Verify all chunks are valid audio files (can be decoded back to PCM). Write in `src/__tests__/chunk.test.ts`. | Status: done

- [x] **Test size compliance** — Verify `chunk.byteLength <= maxFileSize` for all chunks across multiple test inputs. Verify `chunk.duration <= maxDuration` for all chunks. Test with both limits set simultaneously. | Status: done

- [ ] **Test VAD integration** — Test energy VAD produces correct chunks for a clean recording. Test custom VAD function is called with correct arguments and its results are used for chunking. Test fallback from Silero to energy VAD when `@ricky0123/vad-node` is not installed. | Status: not_done

- [ ] **Test format conversion** — Test WAV input -> WAV output works without ffmpeg. Test MP3 input -> WAV output works with ffmpeg, fails gracefully without it. Test WAV input -> MP3 output works with ffmpeg. Test sample rate conversion (44.1kHz -> 16kHz). Test channel conversion (stereo -> mono). | Status: not_done

## Phase 28: Integration Tests — Streaming Mode

- [ ] **Test streaming mode basic operation** — Feed audio data in small chunks (e.g., 1024 bytes at a time), verify `'chunk'` events are emitted. Test `end()` flushes remaining audio as a final chunk. Write in `src/__tests__/factory.test.ts`. | Status: not_done

- [ ] **Test streaming mode consistency** — Verify chunk metadata in streaming mode matches batch mode for the same input (same chunk boundaries, same overlap, same metadata). | Status: not_done

- [ ] **Test streaming mode error handling** — Verify `'error'` event is emitted for invalid input format. Verify `processedDuration` and `chunkCount` are correctly updated. | Status: not_done

## Phase 29: Integration Tests — `detectSpeechSegments()`

- [x] **Test `detectSpeechSegments()` function** — Test that it returns correct speech segments for known audio. Test that it applies segment merging correctly. Test with energy VAD and custom VAD. Test with different `minSilenceDuration` and `minSpeechDuration` values. Write in `src/__tests__/detect.test.ts`. | Status: done

## Phase 30: CLI Tests

- [ ] **Test CLI `chunk` command** — Test `audio-chunker chunk file.wav` produces chunk files in `./chunks/`. Test `--output-dir` writes to specified directory. Test `--json` outputs JSON to stdout. Test `--format`, `--sample-rate`, `--max-size`, `--max-duration`, `--overlap` options. Write in `src/__tests__/cli.test.ts`. | Status: not_done

- [ ] **Test CLI `detect` command** — Test `audio-chunker detect file.wav` outputs speech segments. Test `--format text` and `--format json` output modes. | Status: not_done

- [ ] **Test CLI error handling** — Test invalid file path produces exit code 1. Test invalid flags produce exit code 2. Test `--version` prints version and exits with code 0. Test `--help` prints help and exits with code 0. | Status: not_done

## Phase 31: Edge Case Tests

- [x] **Test empty audio** — Zero-length file or buffer returns empty array with no chunks. | Status: done

- [x] **Test audio with no speech** — Pure silence recording returns single chunk with `noSpeechDetected: true`. | Status: done

- [x] **Test continuous speech (no silence)** — 5+ minutes of continuous speech with no gaps force-splits at `maxDuration` boundaries. All chunks have `forceSplit: true`. | Status: done

- [x] **Test very short audio** — 0.1 second audio produces single chunk. | Status: done

- [ ] **Test very long silence** — Audio with 10+ minutes of silence in the middle: silence is split at midpoint, not assigned entirely to one chunk. | Status: not_done

- [x] **Test rapid speech/silence alternation** — Audio alternating speech/silence every 100ms: segments are merged by `minSilenceDuration`, producing fewer, larger segments. | Status: done

- [x] **Test mono vs stereo input** — Both mono and stereo input produce mono output. | Status: done

- [ ] **Test various sample rates** — Input at 8kHz, 16kHz, 22.05kHz, 44.1kHz, 48kHz all resample to target rate correctly. | Status: not_done

- [x] **Test corrupted WAV header** — Throws `InvalidAudioError` with descriptive message. | Status: done

- [x] **Test non-audio file** — A text file with `.wav` extension throws `InvalidAudioError`. | Status: done

## Phase 32: Test Fixtures

- [x] **Generate synthetic test fixtures** — Create fixture generation scripts or inline fixture creation in tests. Generate: `speech-10s.wav` (10s with alternating sine wave and silence), `silence-5s.wav` (5s of silence), `tone-alternating.wav` (alternating tone/silence for VAD tests). Use sine waves + silence for deterministic, reproducible test inputs. Place in `src/__tests__/fixtures/`. | Status: done

## Phase 33: Performance and Memory

- [ ] **Implement streaming internal processing for large files** — For the `chunk()` function with large file input, process audio in segments rather than loading the entire decoded file into memory. Decode and process in chunks, keeping only the current chunk's samples in memory. | Status: not_done

- [ ] **Memory usage verification** — Verify that peak memory usage for a large file is bounded by the maximum single chunk size (not the entire file). Test with a synthetically large input. | Status: not_done

- [ ] **Performance benchmarks** — Create benchmark tests verifying performance targets: 10s WAV < 200ms (Silero VAD), 10s WAV < 50ms (energy VAD), 10min WAV < 2s, 60min WAV < 10s. Document results. | Status: not_done

## Phase 34: Documentation

- [x] **Create README.md** — Write comprehensive README with: package description, installation instructions (including optional peer dependencies and system ffmpeg), quick start example, API reference for `chunk()`, `detectSpeechSegments()`, and `createChunker()`, configuration options table with all defaults, CLI usage with examples, format support table, VAD options explanation, overlap explanation, integration examples with Whisper/Google/AWS, monorepo integration examples (tts-queue, voice-turn, stream-tokens). | Status: done

- [ ] **Add JSDoc comments to all public API functions and types** — Add JSDoc documentation strings to `chunk()`, `detectSpeechSegments()`, `createChunker()`, and all exported types/interfaces. Include parameter descriptions, return type descriptions, and usage examples in the doc comments. | Status: not_done

## Phase 35: Package Configuration and Publishing

- [ ] **Update package.json for publishing** — Ensure all fields are correct: `name`, `version` (bump as appropriate), `description`, `main` (dist/index.js), `types` (dist/index.d.ts), `bin` (audio-chunker -> dist/cli.js), `files` (dist), `keywords` (audio, chunker, vad, transcription, whisper, speech, etc.), `license` (MIT), `engines` (node >= 18), `publishConfig` (access: public). Add `dependencies` (`fluent-ffmpeg`), `peerDependencies` (`@ricky0123/vad-node`), `peerDependenciesMeta`, and `devDependencies`. | Status: not_done

- [ ] **Verify build output** — Run `npm run build` and verify that `dist/` contains all compiled JS files, declaration files (`.d.ts`), declaration maps, and source maps. Verify the CLI entry point at `dist/cli.js` has the correct shebang and is executable. | Status: not_done

- [ ] **Verify `npm pack` output** — Run `npm pack --dry-run` and verify only `dist/` files are included. No test files, source TypeScript, or fixtures should be in the published package. | Status: not_done

- [ ] **Run full test suite before publish** — Execute `npm run test`, `npm run lint`, and `npm run build` in sequence. All must pass. | Status: not_done
