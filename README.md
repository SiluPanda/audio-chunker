# audio-chunker

Split audio into transcription-ready segments using voice activity detection boundaries.

[![npm version](https://img.shields.io/npm/v/audio-chunker.svg)](https://www.npmjs.com/package/audio-chunker)
[![npm downloads](https://img.shields.io/npm/dt/audio-chunker.svg)](https://www.npmjs.com/package/audio-chunker)
[![license](https://img.shields.io/npm/l/audio-chunker.svg)](https://github.com/SiluPanda/audio-chunker/blob/master/LICENSE)
[![node](https://img.shields.io/node/v/audio-chunker.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

Given a WAV audio buffer, `audio-chunker` runs energy-based voice activity detection (VAD) to identify speech and silence regions, splits at silence boundaries, adds configurable overlap at chunk boundaries, and returns an array of `AudioChunk` objects ready to submit to transcription APIs such as OpenAI Whisper, Google Cloud Speech-to-Text, or AWS Transcribe.

The package solves the problem of transcription API file-size and duration limits. A 90-minute podcast recorded at 44.1 kHz stereo WAV is approximately 950 MB -- 38 times the 25 MB Whisper limit. Naive splitting at arbitrary byte offsets cuts words in half. `audio-chunker` analyzes the audio for speech and silence, splits at natural silence gaps, adds overlap so words near boundaries appear in at least one chunk, resamples to a speech-optimized sample rate, and encodes each chunk as a valid WAV file that fits within API constraints.

Zero runtime dependencies. No ffmpeg required for WAV-to-WAV processing.

## Installation

```bash
npm install audio-chunker
```

## Quick Start

```typescript
import { chunk } from 'audio-chunker';
import { readFileSync } from 'fs';

const audio = readFileSync('./recording.wav');
const result = await chunk(audio, { maxFileSize: '25mb' });

for (const c of result.chunks) {
  console.log(`Chunk ${c.index}: ${c.startMs}ms - ${c.endMs}ms (${c.sizeBytes} bytes)`);
  // c.data is a valid WAV Buffer ready for transcription API submission
}
```

## Features

- **VAD-aware splitting** -- Splits at silence boundaries, never mid-word, using energy-based voice activity detection with configurable RMS threshold.
- **File size enforcement** -- Each chunk stays within a configurable maximum file size (default 25 MB), matching the OpenAI Whisper API limit.
- **Duration enforcement** -- Optionally cap chunk duration with `maxDurationMs`.
- **Overlap at boundaries** -- Configurable overlap (default 1 second) duplicates audio at chunk boundaries so words near split points appear in at least one chunk.
- **Automatic resampling** -- Resamples from any input sample rate to a target rate (default 16 kHz) using linear interpolation.
- **Stereo to mono** -- Multi-channel audio is automatically averaged to mono.
- **Bit depth support** -- Reads 8-bit, 16-bit, 24-bit, and 32-bit PCM WAV files.
- **Force-split fallback** -- When continuous speech exceeds limits and no silence gap exists, the chunker force-splits and marks the chunk with `forceSplit: true`.
- **Custom VAD** -- Plug in any VAD implementation (Silero, WebRTC, or your own) via the `vad` option.
- **Speech detection API** -- Use `detectSpeechSegments()` to run VAD without chunking, returning a timeline of speech and silence regions.
- **WAV utilities** -- Parse, encode, resample, and inspect WAV files with exported utility functions.
- **Zero runtime dependencies** -- Pure TypeScript implementation with no native modules or external binaries.
- **Full TypeScript support** -- Ships with declaration files and source maps.

## API Reference

### `chunk(source, options?)`

Split audio into transcription-ready chunks.

**Signature:**

```typescript
function chunk(source: AudioSource, options?: ChunkOptions): Promise<ChunkResult>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Buffer` | Buffer containing WAV audio data. |
| `options` | `ChunkOptions` | Optional configuration object. See [Configuration](#configuration). |

**Returns:** `Promise<ChunkResult>`

| Field | Type | Description |
|-------|------|-------------|
| `chunks` | `AudioChunk[]` | Array of audio chunks. |
| `totalDurationMs` | `number` | Total duration of the source audio in milliseconds. |
| `sourceFormat` | `string` | Detected format of the source audio (e.g., `'wav'`). |

**Example:**

```typescript
import { chunk } from 'audio-chunker';
import { readFileSync, writeFileSync } from 'fs';

const audio = readFileSync('./meeting.wav');
const result = await chunk(audio, {
  maxFileSize: '25mb',
  maxDurationMs: 600000,
  overlapMs: 1000,
  sampleRate: 16000,
});

console.log(`Source: ${result.sourceFormat}, ${result.totalDurationMs}ms`);
console.log(`Produced ${result.chunks.length} chunks`);

for (const c of result.chunks) {
  writeFileSync(`./chunks/chunk-${String(c.index).padStart(3, '0')}.wav`, c.data);
}
```

---

### `detectSpeechSegments(source, options?)`

Run voice activity detection and return a timeline of speech and silence segments without chunking.

**Signature:**

```typescript
function detectSpeechSegments(source: AudioSource, options?: ChunkOptions): Promise<VADSegment[]>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `Buffer` | Buffer containing WAV audio data. |
| `options` | `ChunkOptions` | Optional configuration (uses VAD-related fields only). |

**Returns:** `Promise<VADSegment[]>`

Each `VADSegment` has:

| Field | Type | Description |
|-------|------|-------------|
| `startMs` | `number` | Start time in milliseconds. |
| `endMs` | `number` | End time in milliseconds. |
| `type` | `'speech' \| 'silence'` | Whether the segment contains speech or silence. |

The returned array covers the entire audio duration from 0 to `totalDurationMs`, with alternating speech and silence segments.

**Example:**

```typescript
import { detectSpeechSegments } from 'audio-chunker';
import { readFileSync } from 'fs';

const audio = readFileSync('./recording.wav');
const segments = await detectSpeechSegments(audio);

for (const seg of segments) {
  console.log(`${seg.startMs}ms - ${seg.endMs}ms: ${seg.type}`);
}
// 0ms - 520ms: silence
// 520ms - 3200ms: speech
// 3200ms - 3800ms: silence
// 3800ms - 7100ms: speech
// 7100ms - 8000ms: silence
```

---

### `parseWav(buffer)`

Parse WAV file headers and return metadata without decoding PCM data.

**Signature:**

```typescript
function parseWav(buffer: Buffer): WavInfo
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `buffer` | `Buffer` | Buffer containing WAV file data. |

**Returns:** `WavInfo`

| Field | Type | Description |
|-------|------|-------------|
| `sampleRate` | `number` | Sample rate in Hz. |
| `channels` | `number` | Number of channels. |
| `bitDepth` | `number` | Bits per sample (8, 16, 24, or 32). |
| `dataOffset` | `number` | Byte offset where PCM data begins. |
| `dataSize` | `number` | Size of the PCM data in bytes. |
| `durationMs` | `number` | Duration of the audio in milliseconds. |
| `audioFormat` | `number` | Audio format code (1 = PCM). |
| `blockAlign` | `number` | Block align (bytes per frame). |
| `byteRate` | `number` | Byte rate. |

**Throws:** `Error` if the buffer is not a valid PCM WAV file (invalid RIFF header, missing fmt/data chunks, unsupported encoding).

**Example:**

```typescript
import { parseWav } from 'audio-chunker';
import { readFileSync } from 'fs';

const wav = readFileSync('./audio.wav');
const info = parseWav(wav);
console.log(`${info.sampleRate}Hz, ${info.channels}ch, ${info.bitDepth}-bit, ${info.durationMs}ms`);
// 44100Hz, 2ch, 16-bit, 185000ms
```

---

### `extractPcmFloat32(buffer, info)`

Extract raw PCM samples from a WAV buffer as a Float32Array with values normalized to [-1.0, 1.0]. Multi-channel audio is averaged to mono.

**Signature:**

```typescript
function extractPcmFloat32(buffer: Buffer, info: WavInfo): Float32Array
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `buffer` | `Buffer` | Buffer containing WAV file data. |
| `info` | `WavInfo` | Parsed WAV info from `parseWav()`. |

**Returns:** `Float32Array` of mono PCM samples in [-1.0, 1.0].

**Example:**

```typescript
import { parseWav, extractPcmFloat32 } from 'audio-chunker';
import { readFileSync } from 'fs';

const wav = readFileSync('./audio.wav');
const info = parseWav(wav);
const samples = extractPcmFloat32(wav, info);
console.log(`${samples.length} samples`);
```

---

### `resample(samples, sourceSampleRate, targetSampleRate)`

Resample PCM audio to a target sample rate using linear interpolation. Returns the input array unchanged if the source and target rates are equal.

**Signature:**

```typescript
function resample(samples: Float32Array, sourceSampleRate: number, targetSampleRate: number): Float32Array
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `samples` | `Float32Array` | Input PCM samples. |
| `sourceSampleRate` | `number` | Source sample rate in Hz. |
| `targetSampleRate` | `number` | Target sample rate in Hz. |

**Returns:** `Float32Array` of resampled PCM samples.

**Example:**

```typescript
import { resample } from 'audio-chunker';

const downsampled = resample(samples44k, 44100, 16000);
```

---

### `encodeWav(samples, sampleRate, channels?, bitDepth?)`

Encode a Float32Array of PCM samples to a WAV buffer.

**Signature:**

```typescript
function encodeWav(samples: Float32Array, sampleRate: number, channels?: number, bitDepth?: number): Buffer
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `samples` | `Float32Array` | -- | PCM samples in [-1.0, 1.0]. Values outside this range are clamped. |
| `sampleRate` | `number` | -- | Sample rate in Hz. |
| `channels` | `number` | `1` | Number of channels. |
| `bitDepth` | `number` | `16` | Bits per sample (8 or 16). |

**Returns:** `Buffer` containing a complete, valid WAV file.

**Example:**

```typescript
import { encodeWav } from 'audio-chunker';
import { writeFileSync } from 'fs';

const sineWave = new Float32Array(16000);
for (let i = 0; i < sineWave.length; i++) {
  sineWave[i] = Math.sin(2 * Math.PI * 440 * i / 16000);
}

const wav = encodeWav(sineWave, 16000);
writeFileSync('./tone.wav', wav);
```

---

### `detectFormat(buffer)`

Detect audio format from a buffer's magic bytes.

**Signature:**

```typescript
function detectFormat(buffer: Buffer): string
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `buffer` | `Buffer` | Buffer containing audio data (at least 12 bytes for reliable detection). |

**Returns:** `'wav'`, `'mp3'`, `'flac'`, `'ogg'`, or `'unknown'`.

**Example:**

```typescript
import { detectFormat } from 'audio-chunker';
import { readFileSync } from 'fs';

const buf = readFileSync('./audio-file');
console.log(detectFormat(buf)); // 'wav'
```

---

### `detectSpeech(samples, sampleRate, options?)`

Run the built-in energy-based VAD on raw PCM samples and return speech segments.

**Signature:**

```typescript
function detectSpeech(
  samples: Float32Array,
  sampleRate: number,
  options?: EnergyVadOptions
): Promise<SpeechSegment[]>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `samples` | `Float32Array` | Mono PCM samples in [-1.0, 1.0]. |
| `sampleRate` | `number` | Sample rate in Hz. |
| `options.energyThreshold` | `number` | RMS energy threshold (default: `0.01`). |
| `options.frameSizeMs` | `number` | Analysis frame size in ms (default: `30`). |
| `options.hopSizeMs` | `number` | Hop size between frames in ms (default: `15`). |
| `options.minSilenceMs` | `number` | Minimum silence duration in ms to keep segments separate (default: `500`). |
| `options.minSpeechMs` | `number` | Minimum speech duration in ms; shorter segments are discarded (default: `250`). |

**Returns:** `Promise<SpeechSegment[]>` where each segment has `start` and `end` in seconds.

**Example:**

```typescript
import { detectSpeech, parseWav, extractPcmFloat32 } from 'audio-chunker';
import { readFileSync } from 'fs';

const wav = readFileSync('./recording.wav');
const info = parseWav(wav);
const samples = extractPcmFloat32(wav, info);
const segments = await detectSpeech(samples, info.sampleRate, {
  energyThreshold: 0.02,
  minSilenceMs: 300,
});

for (const seg of segments) {
  console.log(`Speech: ${seg.start.toFixed(2)}s - ${seg.end.toFixed(2)}s`);
}
```

---

### `parseSize(input)`

Parse a human-readable file size string to bytes.

**Signature:**

```typescript
function parseSize(input: string | number): number
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `input` | `string \| number` | Size as a string (e.g., `'25mb'`, `'500kb'`, `'1gb'`) or a number (bytes). |

Supported units (case-insensitive): `b`, `kb`, `mb`, `gb`, `tb`. Uses binary (1024-based) interpretation.

**Returns:** Size in bytes as an integer.

**Throws:** `Error` for invalid formats, negative numbers, `NaN`, or `Infinity`.

**Example:**

```typescript
import { parseSize } from 'audio-chunker';

parseSize('25mb');  // 26214400
parseSize('500kb'); // 512000
parseSize('1gb');   // 1073741824
parseSize(1024);    // 1024
```

---

### `estimateWavSize(durationMs, sampleRate, channels, bitDepth?)`

Estimate the encoded file size of a WAV chunk.

**Signature:**

```typescript
function estimateWavSize(durationMs: number, sampleRate: number, channels: number, bitDepth?: number): number
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `durationMs` | `number` | -- | Duration in milliseconds. |
| `sampleRate` | `number` | -- | Sample rate in Hz. |
| `channels` | `number` | -- | Number of channels. |
| `bitDepth` | `number` | `16` | Bits per sample. |

**Returns:** Estimated file size in bytes (44-byte header + PCM data).

**Example:**

```typescript
import { estimateWavSize } from 'audio-chunker';

estimateWavSize(1000, 16000, 1);     // 32044  (1 second, 16kHz, mono, 16-bit)
estimateWavSize(60000, 16000, 1);    // 1920044 (1 minute)
estimateWavSize(1000, 44100, 2);     // 176444 (1 second, 44.1kHz, stereo)
```

## Configuration

The `ChunkOptions` object controls all chunking behavior:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxFileSize` | `string \| number` | `'25mb'` | Maximum encoded file size per chunk. Accepts bytes or strings like `'25mb'`, `'10MB'`, `'1gb'`. |
| `maxDurationMs` | `number` | `Infinity` | Maximum duration per chunk in milliseconds. |
| `overlapMs` | `number` | `1000` | Overlap duration in milliseconds at chunk boundaries. Audio in the overlap region appears in both adjacent chunks. |
| `minSilenceMs` | `number` | `500` | Minimum silence gap in milliseconds to qualify as a split point. |
| `minSpeechMs` | `number` | `250` | Minimum speech segment duration in milliseconds. Segments shorter than this are discarded. |
| `sampleRate` | `number` | `16000` | Target sample rate in Hz. Input audio is resampled to this rate. |
| `channels` | `number` | `1` | Number of output channels. |
| `format` | `'wav'` | `'wav'` | Output audio format. |
| `energyThreshold` | `number` | `0.01` | RMS energy threshold for the built-in VAD. Frames with energy above this are classified as speech. Range: 0.0 to 1.0. |
| `vad` | `VadFunction` | -- | Custom VAD function. Overrides the built-in energy-based VAD. See [Custom VAD](#custom-vad). |

## Error Handling

`audio-chunker` throws standard `Error` instances with descriptive messages:

| Condition | Error Message |
|-----------|---------------|
| Source is not a Buffer | `Source must be a Buffer containing audio data.` |
| Unsupported audio format | `Unsupported audio format: "<format>". Only WAV format is supported without ffmpeg.` |
| Buffer too small for WAV | `Buffer too small to be a valid WAV file (minimum 44 bytes for header).` |
| Invalid RIFF header | `Invalid WAV file: expected RIFF header, got "<bytes>".` |
| Invalid WAVE format | `Invalid WAV file: expected WAVE format, got "<bytes>".` |
| Missing fmt chunk | `Invalid WAV file: fmt chunk not found.` |
| Missing data chunk | `Invalid WAV file: data chunk not found.` |
| Non-PCM encoding | `Unsupported WAV format: audio format code <code>. Only PCM (format 1) is supported.` |
| Invalid header values | `Invalid WAV file: zero value in channels, sample rate, or bit depth.` |
| Invalid size string | `Invalid size format: "<input>". Expected a string like '25mb', '10kb', '1gb', or '500b'.` |
| Negative or non-finite size | `Invalid size: <value>. Must be a non-negative finite number.` |

Empty buffers are handled gracefully: `chunk()` returns `{ chunks: [], totalDurationMs: 0, sourceFormat: 'unknown' }` and `detectSpeechSegments()` returns `[]`.

## Advanced Usage

### Splitting for the OpenAI Whisper API

```typescript
import { chunk } from 'audio-chunker';
import { readFileSync } from 'fs';
import OpenAI from 'openai';

const openai = new OpenAI();
const audio = readFileSync('./long-meeting.wav');

const result = await chunk(audio, {
  maxFileSize: '25mb',
  sampleRate: 16000,
  overlapMs: 1000,
});

const transcriptions = await Promise.all(
  result.chunks.map(async (c) => {
    const response = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file: new File([c.data], `chunk-${c.index}.wav`, { type: 'audio/wav' }),
    });
    return { index: c.index, startMs: c.startMs, text: response.text };
  }),
);

for (const t of transcriptions) {
  console.log(`[${t.startMs}ms] ${t.text}`);
}
```

### Custom VAD

Plug in any VAD implementation by providing a function that accepts a `Float32Array` and sample rate, and returns an array of `SpeechSegment` objects:

```typescript
import { chunk } from 'audio-chunker';
import type { VadFunction } from 'audio-chunker';

const myVad: VadFunction = async (audio, sampleRate) => {
  // Your VAD logic -- e.g., Silero, WebRTC, or a cloud API
  return [
    { start: 0.0, end: 3.5 },
    { start: 4.2, end: 8.1 },
    { start: 10.0, end: 15.3 },
  ];
};

const result = await chunk(wavBuffer, { vad: myVad });
```

The `VadFunction` type signature:

```typescript
type VadFunction = (audio: Float32Array, sampleRate: number) => Promise<SpeechSegment[]>;
```

Each `SpeechSegment` has `start` and `end` times in seconds.

### Duration-Based Splitting

Cap each chunk to a maximum duration regardless of file size:

```typescript
const result = await chunk(audio, {
  maxDurationMs: 300000, // 5 minutes per chunk
  overlapMs: 2000,
});
```

### Analyzing Speech Without Chunking

Use `detectSpeechSegments()` to inspect the speech/silence timeline without producing chunks:

```typescript
import { detectSpeechSegments } from 'audio-chunker';

const segments = await detectSpeechSegments(wavBuffer, {
  energyThreshold: 0.02,
  minSilenceMs: 300,
  minSpeechMs: 200,
});

const speechTotal = segments
  .filter((s) => s.type === 'speech')
  .reduce((sum, s) => sum + (s.endMs - s.startMs), 0);

console.log(`Total speech: ${(speechTotal / 1000).toFixed(1)}s`);
```

### WAV Encode/Decode Roundtrip

```typescript
import { encodeWav, parseWav, extractPcmFloat32, resample } from 'audio-chunker';
import { readFileSync, writeFileSync } from 'fs';

// Read a 44.1kHz WAV and re-encode at 16kHz
const original = readFileSync('./input-44100.wav');
const info = parseWav(original);
const samples = extractPcmFloat32(original, info);
const resampled = resample(samples, info.sampleRate, 16000);
const output = encodeWav(resampled, 16000);
writeFileSync('./output-16000.wav', output);
```

### Zero Overlap

Disable overlap when downstream deduplication is not needed:

```typescript
const result = await chunk(audio, {
  maxFileSize: '25mb',
  overlapMs: 0,
});
```

## TypeScript

All types are exported and available for import:

```typescript
import type {
  AudioChunk,
  AudioFormat,
  ChunkOptions,
  AudioSource,
  VADSegment,
  ChunkResult,
  WavInfo,
  SpeechSegment,
  VadFunction,
} from 'audio-chunker';
```

### `AudioChunk`

Represents a single audio chunk extracted from a larger recording:

| Field | Type | Description |
|-------|------|-------------|
| `index` | `number` | Zero-based index in the result array. |
| `startMs` | `number` | Start time in milliseconds from source audio start. |
| `endMs` | `number` | End time in milliseconds from source audio start. |
| `durationMs` | `number` | Duration in milliseconds. |
| `data` | `Buffer` | Encoded audio data (valid WAV file). |
| `format` | `AudioFormat` | Output format (`'wav'`). |
| `sizeBytes` | `number` | Size of the encoded data in bytes. |
| `overlapMs` | `number` | Overlap duration at the start of this chunk (0 for the first chunk). |
| `forceSplit` | `boolean \| undefined` | `true` if the chunk was force-split due to no silence boundary. |
| `noSpeechDetected` | `boolean \| undefined` | `true` if no speech was detected in this chunk. |

### `SpeechSegment`

A speech region detected by VAD:

| Field | Type | Description |
|-------|------|-------------|
| `start` | `number` | Start time in seconds. |
| `end` | `number` | End time in seconds. |

### `VadFunction`

Custom VAD function signature:

```typescript
type VadFunction = (audio: Float32Array, sampleRate: number) => Promise<SpeechSegment[]>;
```

## How It Works

1. **Parse WAV** -- Read RIFF/WAVE headers and extract raw PCM audio data. Supports 8/16/24/32-bit PCM, mono and stereo.
2. **Normalize** -- Resample to the target sample rate (default 16 kHz) using linear interpolation. Average multi-channel audio to mono.
3. **VAD** -- Classify 30 ms frames (with 15 ms hop) as speech or silence based on RMS energy. Frames with energy above the threshold are marked as speech.
4. **Merge** -- Merge adjacent speech segments separated by gaps shorter than `minSilenceMs`. Discard segments shorter than `minSpeechMs`.
5. **Group** -- Accumulate speech segments into chunks. When adding the next segment would exceed `maxFileSize` or `maxDurationMs`, split at the silence gap between the last included segment and the next. If no gap exists, force-split at the limit.
6. **Overlap** -- Extend chunk boundaries into adjacent silence gaps to produce the configured overlap duration. The first chunk has no start overlap.
7. **Encode** -- Encode each chunk's PCM samples as a valid 16-bit PCM WAV file with the target sample rate and channel count.

## Supported Formats

| Direction | Format | Details |
|-----------|--------|---------|
| Input | WAV | PCM encoding, 8/16/24/32-bit, any sample rate, mono or stereo. |
| Output | WAV | 16-bit PCM, configurable sample rate (default 16 kHz), mono. |

Format detection recognizes WAV, MP3, FLAC, and OGG magic bytes via `detectFormat()`, but only WAV input is supported for decoding. Non-WAV formats produce a descriptive error message.

## Requirements

- Node.js >= 18
- Zero runtime dependencies

## License

MIT
