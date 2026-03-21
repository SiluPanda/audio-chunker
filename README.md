# audio-chunker

Split audio into transcription-ready segments using voice activity detection boundaries.

Given a WAV audio buffer, `audio-chunker` runs energy-based VAD to identify speech and silence regions, splits at silence boundaries, adds configurable overlap at chunk boundaries, and returns an array of `AudioChunk` objects ready to submit to transcription APIs like OpenAI Whisper.

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

## API

### `chunk(source, options?)`

Split audio into transcription-ready chunks.

**Parameters:**

- `source` — `Buffer` containing WAV audio data
- `options` — Optional `ChunkOptions`:
  - `maxDurationMs` — Maximum duration per chunk in ms (default: `Infinity`)
  - `maxFileSize` — Maximum file size per chunk, as bytes or string like `'25mb'` (default: `'25mb'`)
  - `overlapMs` — Overlap duration at chunk boundaries in ms (default: `1000`)
  - `minSilenceMs` — Minimum silence gap to qualify as a split point in ms (default: `500`)
  - `format` — Output format: `'wav'` (default: `'wav'`)
  - `sampleRate` — Target sample rate in Hz (default: `16000`)
  - `channels` — Number of channels (default: `1`)
  - `minSpeechMs` — Minimum speech segment duration in ms (default: `250`)
  - `energyThreshold` — RMS energy threshold for VAD, 0.0-1.0 (default: `0.01`)
  - `vad` — Custom VAD function `(audio: Float32Array, sampleRate: number) => Promise<SpeechSegment[]>`

**Returns:** `Promise<ChunkResult>` with `chunks`, `totalDurationMs`, and `sourceFormat`.

### `detectSpeechSegments(source, options?)`

Run voice activity detection and return speech/silence segments without chunking.

```typescript
import { detectSpeechSegments } from 'audio-chunker';

const segments = await detectSpeechSegments(wavBuffer);
// [{ startMs: 0, endMs: 500, type: 'silence' }, { startMs: 500, endMs: 3000, type: 'speech' }, ...]
```

### `parseWav(buffer)`

Parse WAV file headers and return metadata.

```typescript
import { parseWav } from 'audio-chunker';

const info = parseWav(wavBuffer);
// { sampleRate: 16000, channels: 1, bitDepth: 16, durationMs: 5000, ... }
```

### `detectSpeech(samples, sampleRate, options?)`

Run energy-based VAD on raw PCM samples.

```typescript
import { detectSpeech } from 'audio-chunker';

const segments = await detectSpeech(float32Samples, 16000);
// [{ start: 0.5, end: 3.2 }, { start: 4.0, end: 7.1 }]
```

### Utility Functions

- `encodeWav(samples, sampleRate, channels?, bitDepth?)` — Encode Float32Array to WAV Buffer
- `extractPcmFloat32(buffer, wavInfo)` — Extract PCM samples from WAV as Float32Array
- `resample(samples, sourceSampleRate, targetSampleRate)` — Resample audio
- `detectFormat(buffer)` — Detect audio format from magic bytes
- `parseSize(input)` — Parse size strings like `'25mb'` to bytes
- `estimateWavSize(durationMs, sampleRate, channels, bitDepth?)` — Estimate WAV file size

## Custom VAD

You can provide your own VAD function:

```typescript
const result = await chunk(wavBuffer, {
  vad: async (audio, sampleRate) => {
    // Your VAD logic here
    return [
      { start: 0.0, end: 3.5 },
      { start: 4.2, end: 8.1 },
    ];
  },
});
```

## How It Works

1. **Parse WAV** — Read WAV headers and extract raw PCM audio data
2. **Normalize** — Resample to target sample rate (default 16 kHz) and convert to mono
3. **VAD** — Classify 30ms frames as speech or silence using RMS energy
4. **Merge** — Merge adjacent speech segments separated by short gaps
5. **Chunk** — Group segments into chunks respecting size and duration limits
6. **Overlap** — Add configurable overlap at chunk boundaries
7. **Encode** — Encode each chunk as a valid WAV file

## Supported Formats

- **Input:** WAV (PCM, 8/16/24/32-bit, any sample rate, mono or stereo)
- **Output:** WAV (16-bit PCM, configurable sample rate, mono)

## Requirements

- Node.js >= 18
- Zero runtime dependencies

## License

MIT
