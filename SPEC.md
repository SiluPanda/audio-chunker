# audio-chunker -- Specification

## 1. Overview

`audio-chunker` is a VAD-aware audio chunking library that splits audio files and streams into transcription-ready segments. Given an audio source (file path, Buffer, or readable stream), it runs voice activity detection to identify speech and silence boundaries, groups speech segments into chunks that respect API file-size and duration limits, adds configurable overlap at chunk boundaries, encodes each chunk to the target format, and returns an array of `AudioChunk` objects ready to submit to transcription APIs. It answers the question "how do I split this 90-minute recording into chunks that Whisper will accept?" with a single function call: `chunk(audioSource, { maxFileSize: '25mb' })`, returning chunks that each fit within the API's constraints, split at natural silence boundaries rather than arbitrary byte offsets.

The gap this package fills is specific and well-defined. Transcription APIs impose strict size and duration limits on audio input. OpenAI's Whisper API accepts files up to 25 MB. Google Cloud Speech-to-Text v2 accepts up to 480 minutes of audio per request but has payload size limits that vary by encoding. AWS Transcribe requires files under 2 GB but performs best with segments under 4 hours. A 90-minute podcast recorded at 44.1 kHz stereo WAV is approximately 950 MB -- 38 times the Whisper limit. A developer who wants to transcribe this recording must split it into chunks small enough for the API, but naive splitting at arbitrary byte boundaries cuts words in half, producing garbled transcription at every chunk boundary. The correct approach is to analyze the audio for speech and silence, split at silence gaps, add overlap so that words near boundaries appear in at least one chunk, and encode each chunk to a format that meets the API's requirements.

No existing npm package combines these concerns. VAD libraries like `@ricky0123/vad-node` (Silero VAD via ONNX Runtime) and `node-vad` (WebRTC VAD) detect speech boundaries but do not produce API-ready chunks -- they return timestamp arrays, leaving the developer to buffer, slice, overlap, encode, and enforce size limits manually. Audio manipulation libraries like `fluent-ffmpeg` provide format conversion and segment extraction but require the developer to specify split points -- they have no speech awareness. The `ffmpeg` command-line tool can split audio by duration (`-segment_time`), but it splits at arbitrary time points with no VAD awareness and no overlap. Developers building transcription pipelines currently write 200-400 lines of bespoke buffering, VAD integration, size estimation, re-splitting, and format conversion code. `audio-chunker` replaces all of that with a configured function call.

The package provides both a TypeScript/JavaScript API for programmatic use and a CLI for chunking audio files from the terminal. The API returns typed `AudioChunk` objects with rich metadata (start time, end time, duration, overlap regions, speech segment count, file size, format). A streaming mode accepts real-time audio data (from a microphone, WebSocket, or live broadcast) and emits chunks as they complete. The CLI reads audio files and outputs chunks as individual files or metadata as JSON.

---

## 2. Goals and Non-Goals

### Goals

- Provide a `chunk(audio, options?)` function that reads audio from any supported source (file path, Buffer, readable stream), runs VAD to detect speech boundaries, splits the audio into chunks that respect configurable size and duration limits, adds overlap at boundaries, encodes to the target format, and returns an array of `AudioChunk` objects.
- Provide a pluggable VAD interface so callers can use any VAD implementation. Ship with two built-in adapters: a Silero VAD adapter (via `@ricky0123/vad-node`, high accuracy, ONNX model) and an energy-based VAD fallback (amplitude threshold, zero dependencies, lower accuracy).
- Provide a `detectSpeechSegments(audio, options?)` function that runs VAD only and returns speech segment timestamps without chunking -- useful for analysis, visualization, or custom chunking logic.
- Provide a `createChunker(config)` factory function that returns an `AudioChunker` instance for streaming mode. The chunker accepts audio data incrementally via `write(data)`, runs VAD as data arrives, and emits `'chunk'` events when chunks are complete.
- Enforce API file-size limits: estimate the output file size from sample rate, bit depth, channel count, and compression ratio, and ensure each chunk stays under the configured maximum (default: 25 MB for Whisper). If a chunk would exceed the limit, re-split at finer silence boundaries or force-split at a duration limit.
- Enforce duration limits: ensure each chunk does not exceed a configurable maximum duration (default: no limit).
- Add configurable overlap at chunk boundaries: duplicate a specified duration of audio (default: 1 second) at the boundary so that words near the split point appear in at least one chunk's transcription.
- Convert audio to the target output format: support WAV (default, widest API compatibility), MP3 (smaller files), FLAC (lossless compression), and OGG/Opus (efficient). Resample to a configurable sample rate (default: 16 kHz, the standard for speech recognition). Convert stereo to mono.
- Accept multiple input formats: WAV, MP3, FLAC, OGG, raw PCM, and WebM.
- Provide a CLI (`audio-chunker`) for chunking audio files from the terminal, outputting chunk files to a directory or chunk metadata as JSON.
- Provide rich chunk metadata: index, start time, end time, duration, overlap regions, original file offset, speech segment count within each chunk, file size, format, sample rate, channel count.
- Target Node.js 18+. Use `fluent-ffmpeg` with a system-installed `ffmpeg` binary for format conversion and audio extraction, with a pure-JavaScript fallback for WAV-to-WAV chunking when `ffmpeg` is not available.

### Non-Goals

- **Not a transcription service.** This package splits audio into chunks suitable for transcription APIs. It does not transcribe audio, call any transcription API, or process transcription results. For transcription, use the OpenAI SDK, Google Cloud Speech client, or AWS Transcribe client.
- **Not a VAD library.** This package uses VAD to find chunk boundaries. It does not implement novel VAD algorithms, train VAD models, or provide a general-purpose speech detection API. The built-in Silero adapter wraps `@ricky0123/vad-node`; the energy-based fallback is intentionally simple. For advanced VAD research, use dedicated speech processing libraries.
- **Not an audio editor.** This package extracts and re-encodes segments of audio. It does not apply effects (normalization, noise reduction, equalization, compression), mix tracks, or perform any audio manipulation beyond format conversion, resampling, and channel reduction.
- **Not a speaker diarization tool.** This package detects speech vs. silence. It does not identify who is speaking. For speaker diarization, use `pyannote-audio` or a cloud provider's diarization API.
- **Not a real-time transcription pipeline.** The streaming mode emits chunks as they complete, but it does not manage the downstream transcription, result aggregation, overlap deduplication, or real-time display. Those concerns belong to the application layer or a dedicated pipeline orchestrator.
- **Not a duplicate text deduplicator.** When chunks overlap, the transcription of overlapping regions produces duplicate text. Deduplicating that text is a downstream concern (fuzzy string matching at chunk boundaries) that this package does not address. The chunk metadata includes overlap timing information to facilitate downstream deduplication.

---

## 3. Target Users and Use Cases

### Transcription Pipeline Builders

Developers building batch transcription pipelines that process audio files through speech-to-text APIs. They receive audio files of arbitrary length and format, need to split them into API-compliant chunks, submit each chunk to the transcription API, and reassemble the results. A typical integration replaces 200+ lines of manual buffering, VAD, and encoding code with `const chunks = await chunk('./recording.wav', { maxFileSize: '25mb' })`.

### Podcast Processing Platforms

Teams building podcast hosting or analytics platforms that transcribe episodes for search, show notes, or accessibility. Podcast episodes are typically 30-120 minutes of audio, far exceeding the 25 MB Whisper limit for compressed formats and enormously exceeding it for uncompressed WAV. Episodes are often recorded at 44.1 kHz stereo -- `audio-chunker` resamples to 16 kHz mono and splits at speech boundaries, reducing file sizes by 5-10x before chunking.

### Meeting Recording Systems

Applications that record meetings (Zoom, Teams, Google Meet) and transcribe them for searchable archives or summary generation. Meeting recordings are long (30 minutes to several hours), contain long stretches of silence (screen sharing without narration, breaks), and have natural pauses between speakers. VAD-aware chunking produces cleaner splits than duration-based splitting.

### Call Center Audio Processing

Teams processing thousands of customer service calls for quality analysis, compliance monitoring, or sentiment analysis. Call recordings vary in length (2-60 minutes), format (WAV, MP3, various codecs), and quality (telephone bandwidth, noise). `audio-chunker` normalizes the format, resamples to speech-optimized rates, and produces uniform chunks suitable for batch transcription.

### Live Streaming Transcription

Developers building live transcription for webinars, broadcasts, or accessibility services. Audio arrives as a continuous stream (WebSocket, microphone input) and must be chunked in real-time. The streaming `AudioChunker` buffers incoming audio, runs VAD incrementally, and emits chunks as soon as a silence boundary is detected or the duration limit is reached.

### Voice AI Application Developers

Developers building voice-controlled applications that need to process recorded audio segments. When combined with `voice-turn` (turn-taking manager) and `tts-queue` (TTS streaming manager), `audio-chunker` provides the audio ingestion stage of a voice AI pipeline: receive audio, chunk it, transcribe each chunk, process the text.

### CLI and Script Users

Engineers processing audio files in shell scripts or automation pipelines. The CLI provides a scriptable interface: split an audio file into chunks, write chunk files to a directory, and output metadata as JSON for downstream processing.

---

## 4. Core Concepts

### Audio Chunk

An audio chunk is a contiguous segment of audio extracted from a larger recording, encoded to a specific format, and paired with metadata describing its temporal position, size, and speech content. Each chunk is designed to be independently submittable to a transcription API -- it is a valid audio file in the target format, within the API's size and duration limits, and split at a natural speech boundary rather than an arbitrary byte offset.

### Voice Activity Detection (VAD)

Voice activity detection is the process of classifying each frame of audio as speech or non-speech. VAD algorithms analyze audio features -- spectral energy, zero-crossing rate, pitch, or learned neural features -- to determine whether a human voice is present. The output is a timeline of speech segments: `[{ start: 0.0, end: 3.2, speech: true }, { start: 3.2, end: 3.8, speech: false }, ...]`. `audio-chunker` uses VAD output to identify natural split points -- the silence gaps between speech segments -- where chunking will not cut through spoken words.

### Speech Segment

A speech segment is a contiguous region of audio that VAD classifies as containing speech. A speech segment has a start time, end time, and duration. Adjacent speech segments are separated by silence gaps. The duration and timing of speech segments drive all chunking decisions: speech segments are the atomic units that must not be split, and the silence gaps between them are the candidate split points.

### Silence Gap

A silence gap is a contiguous region of audio between two speech segments where no speech is detected. Silence gaps are the primary candidates for chunk split points. Not all silence gaps are suitable for splitting -- a brief 100 ms pause between syllables should not be a split point. The `minSilenceDuration` option (default: 500 ms) sets the minimum gap duration that qualifies as a split point. Longer gaps are preferred over shorter gaps when multiple candidates exist.

### Overlap

Overlap is the intentional duplication of audio at chunk boundaries. When overlap is configured, the end of one chunk and the beginning of the next chunk share a region of audio. If chunk N ends at time 10.0s and overlap is 1.0s, chunk N includes audio up to 10.5s and chunk N+1 starts at 9.5s, so the region from 9.5s to 10.5s appears in both chunks. This ensures that any word spoken near the split point is fully captured in at least one chunk's transcription. The transcription of overlapping regions will contain duplicate text; downstream deduplication (outside this package's scope) resolves this using the overlap timing metadata that each chunk carries.

### File Size Limit

Transcription APIs impose maximum file size limits on audio input. OpenAI Whisper accepts files up to 25 MB. Google Cloud Speech-to-Text accepts up to 10 MB for synchronous requests and larger files for asynchronous (via GCS). AWS Transcribe accepts up to 2 GB but recommends smaller segments. `audio-chunker` enforces a configurable maximum file size (default: 25 MB) by estimating the encoded size of each chunk before finalizing it. If a chunk would exceed the limit, the chunker re-splits at finer boundaries within the chunk.

### Duration Limit

Some transcription APIs or use cases impose maximum duration limits. A caller may want chunks no longer than 5 minutes for parallel processing, or an API may limit request duration. `audio-chunker` enforces a configurable maximum duration (default: no limit) by splitting at the silence gap nearest to the duration limit.

### Format Conversion

Audio files come in many formats and encodings. Transcription APIs typically accept a subset: Whisper accepts MP3, MP4, MPEG, MPGA, M4A, WAV, and WEBM. Google Speech-to-Text accepts FLAC, LINEAR16 (WAV), MULAW, AMR, AMR-WB, OGG_OPUS, SPEEX, WEBM_OPUS, and MP3. `audio-chunker` decodes the input audio from any supported format and re-encodes each chunk to the configured output format (default: WAV for widest compatibility). Format conversion includes resampling (e.g., 44.1 kHz to 16 kHz for speech APIs) and channel conversion (stereo to mono).

---

## 5. VAD Integration

### Pluggable VAD Interface

`audio-chunker` defines a VAD interface that any implementation can satisfy. The interface is a single function that accepts audio samples and returns speech segments:

```typescript
type VadFunction = (
  audio: Float32Array,
  sampleRate: number,
) => Promise<SpeechSegment[]>;

interface SpeechSegment {
  /** Start time in seconds from the beginning of the audio. */
  start: number;

  /** End time in seconds from the beginning of the audio. */
  end: number;
}
```

The caller provides a `VadFunction` via the `vad` option. If no VAD function is provided, `audio-chunker` selects the best available built-in adapter: Silero VAD if `@ricky0123/vad-node` is installed, otherwise the energy-based fallback.

### Silero VAD Adapter

The Silero VAD adapter wraps `@ricky0123/vad-node`, which runs the Silero VAD model via ONNX Runtime. Silero VAD is a lightweight neural network trained on large-scale speech data, providing high-accuracy speech detection across languages, accents, noise conditions, and recording quality.

**Characteristics:**
- **Accuracy**: State-of-the-art for a lightweight model. Handles overlapping speech, background music, noise, and non-speech vocalizations (coughing, laughing) well.
- **Latency**: Processes audio in approximately 1 ms per second of audio on modern hardware. Suitable for real-time use.
- **Dependencies**: Requires `@ricky0123/vad-node` and `onnxruntime-node` as peer dependencies. These are substantial native dependencies (~50 MB installed).
- **Sample rate**: Operates on 16 kHz audio. Input at other sample rates is resampled before VAD processing.
- **Frame size**: Processes audio in 30 ms frames (480 samples at 16 kHz).
- **Output**: Returns speech segments with start and end timestamps. Adjacent speech frames separated by less than the `minSilenceDuration` threshold are merged into a single segment.

**Adapter configuration:**

```typescript
interface SileroVadOptions {
  /** Probability threshold for speech detection (0.0 - 1.0).
   *  Higher values require more confidence that speech is present.
   *  Default: 0.5. */
  threshold?: number;

  /** Minimum silence duration in milliseconds to consider a gap between
   *  speech segments. Shorter silences are merged into the surrounding
   *  speech. Default: 500. */
  minSilenceDurationMs?: number;

  /** Minimum speech duration in milliseconds. Speech segments shorter
   *  than this are discarded (likely noise). Default: 250. */
  minSpeechDurationMs?: number;

  /** Padding in milliseconds to add before and after each speech segment.
   *  Prevents clipping the beginning or end of speech.
   *  Default: 100. */
  speechPadMs?: number;
}
```

**How it integrates:**

```typescript
import { chunk } from 'audio-chunker';

// Automatic: uses Silero if @ricky0123/vad-node is installed
const chunks = await chunk('./recording.wav');

// Explicit: configure Silero VAD parameters
const chunks = await chunk('./recording.wav', {
  vad: 'silero',
  vadOptions: {
    threshold: 0.6,
    minSilenceDurationMs: 300,
  },
});
```

### Energy-Based VAD Fallback

The energy-based VAD is a simple, zero-dependency fallback that detects speech by measuring the root-mean-square (RMS) energy of audio frames. When the RMS energy of a frame exceeds a threshold, the frame is classified as speech. This approach works reasonably well for clean recordings with clear speech and distinct silence gaps, but performs poorly with background noise, music, or low-volume speech.

**Algorithm:**

```
for each frame (30ms window, 15ms hop):
  rms = sqrt(mean(samples^2))
  if rms > threshold:
    mark frame as speech
  else:
    mark frame as silence

merge adjacent speech frames
discard speech segments shorter than minSpeechDuration
discard silence gaps shorter than minSilenceDuration
```

**Characteristics:**
- **Accuracy**: Low to moderate. Works for clean studio recordings and clear telephone audio. Fails with background music, ambient noise, or whispering.
- **Dependencies**: Zero. Pure JavaScript implementation.
- **Performance**: Extremely fast. Processes audio in microseconds per second.
- **Configuration**: RMS threshold (default: 0.01, tunable), frame size (default: 30 ms), hop size (default: 15 ms).

**When to use:**
- When `@ricky0123/vad-node` cannot be installed (environments without native dependency support, edge/serverless deployments).
- For audio known to have clean speech and clear silence gaps (pre-processed recordings, studio podcasts).
- For initial prototyping before installing the Silero model.

### Custom VAD

The caller provides any VAD function via the `vad` option:

```typescript
import { chunk } from 'audio-chunker';

const myVad: VadFunction = async (audio, sampleRate) => {
  // Custom VAD logic (e.g., call a cloud VAD API, use WebRTC VAD)
  return [
    { start: 0.0, end: 3.5 },
    { start: 4.2, end: 8.1 },
    // ...
  ];
};

const chunks = await chunk('./recording.wav', { vad: myVad });
```

This enables integration with any VAD system: cloud-based VAD APIs, WebRTC VAD (`node-vad`), custom neural models, or pre-computed speech segments from an external tool.

### VAD Segment Merging

Raw VAD output often contains many short speech segments separated by brief pauses (e.g., between words or clauses). These micro-segments are too granular for chunking -- a chunk containing a single 0.3-second speech segment would be wastefully small. `audio-chunker` merges adjacent speech segments separated by silence gaps shorter than `minSilenceDuration`. This produces larger, more meaningful speech regions that correspond to utterances, sentences, or speaker turns rather than individual words.

**Merging algorithm:**

```
input: raw speech segments from VAD
output: merged speech segments

sortedSegments = sort segments by start time
merged = [sortedSegments[0]]

for each segment in sortedSegments[1:]:
  lastMerged = merged[merged.length - 1]
  gap = segment.start - lastMerged.end

  if gap < minSilenceDuration:
    // Merge: extend the last segment to cover this one
    lastMerged.end = max(lastMerged.end, segment.end)
  else:
    // Gap is long enough: keep as separate segments
    merged.push(segment)

return merged
```

---

## 6. Chunking Algorithm

The chunking algorithm is the core of `audio-chunker`. It takes VAD-detected speech segments and produces chunks that respect size limits, duration limits, and overlap requirements, while splitting only at silence boundaries.

### Step 1: Decode and Normalize Audio

Read the input audio and decode it to raw PCM samples. Normalize to a standard internal representation:

- **Format**: 32-bit floating-point PCM (`Float32Array`), values in the range [-1.0, 1.0].
- **Sample rate**: Resample to the configured rate (default: 16 kHz). Resampling is performed using linear interpolation for simplicity, or via `ffmpeg`'s high-quality resampler when available.
- **Channels**: Convert to mono by averaging channels. Mono is standard for speech processing and halves the data size.

If `ffmpeg` is available, decoding and normalization are performed by spawning `ffmpeg` with appropriate flags. If `ffmpeg` is not available, the package uses a built-in WAV parser for WAV input and throws an error for non-WAV formats.

### Step 2: Run VAD

Pass the normalized PCM audio to the configured VAD function. Receive an array of `SpeechSegment` objects representing contiguous speech regions.

Merge segments separated by silence gaps shorter than `minSilenceDuration` (default: 500 ms). Discard segments shorter than `minSpeechDuration` (default: 250 ms). The result is a cleaned list of speech segments.

If the audio contains no detected speech (e.g., a recording of silence or white noise), return a single chunk containing the entire audio with a warning in the metadata (`noSpeechDetected: true`). The caller may want to submit it anyway (some APIs handle silence gracefully) or skip it.

### Step 3: Identify Candidate Split Points

Every silence gap between consecutive merged speech segments is a candidate split point. Each candidate carries:

- **Position**: The midpoint of the silence gap (in seconds).
- **Gap duration**: The duration of the silence gap. Longer gaps are preferred as split points.
- **Left segment end**: The end time of the speech segment before the gap.
- **Right segment start**: The start time of the speech segment after the gap.

Candidate split points are sorted by preference: longer silence gaps first, then by proximity to ideal chunk duration boundaries.

### Step 4: Group Speech Segments into Chunks

Starting from the beginning of the audio, accumulate speech segments into the current chunk until adding the next segment would cause the chunk to exceed either the maximum file size or the maximum duration. When a limit would be exceeded, split at the best candidate split point (longest silence gap) that keeps the current chunk within limits.

**Grouping algorithm:**

```
chunks = []
currentStart = 0  // seconds
currentSegments = []

for each speechSegment in mergedSegments:
  // Estimate chunk size if we include this segment
  candidateEnd = speechSegment.end + overlapDuration
  candidateDuration = candidateEnd - currentStart
  estimatedSize = estimateEncodedSize(candidateDuration, outputFormat, sampleRate)

  if estimatedSize > maxFileSize OR candidateDuration > maxDuration:
    // Current chunk is full. Find the best split point.
    splitPoint = bestSplitPointBefore(speechSegment.start, currentSegments)

    if splitPoint exists:
      // Split at the silence gap
      chunkEnd = splitPoint.leftSegmentEnd + overlapDuration
      emit chunk from currentStart to chunkEnd
      currentStart = splitPoint.rightSegmentStart - overlapDuration
      // Re-process segments after the split point
    else:
      // No silence gap found within current chunk (extremely long continuous speech)
      // Force-split at the duration limit
      forceSplitPoint = currentStart + maxDuration
      emit chunk from currentStart to forceSplitPoint + overlapDuration
      currentStart = forceSplitPoint - overlapDuration

    currentSegments = [speechSegment]
  else:
    currentSegments.push(speechSegment)

// Emit the final chunk
if currentSegments.length > 0:
  emit chunk from currentStart to lastSegment.end
```

### Step 5: Add Overlap

For each pair of adjacent chunks, extend the end of chunk N and the start of chunk N+1 by the configured overlap duration (default: 1 second). The overlap region contains identical audio in both chunks.

- Chunk N's end time is extended by `overlapDuration / 2` (capped at the midpoint of the silence gap).
- Chunk N+1's start time is moved earlier by `overlapDuration / 2` (capped at the midpoint of the silence gap).

If the silence gap is shorter than `overlapDuration`, the overlap fills the entire gap: both chunks extend to their respective edges of the gap, and the gap itself is the overlap region.

The first chunk has no start overlap. The last chunk has no end overlap.

### Step 6: Extract Audio Data

For each chunk, extract the raw PCM samples from the normalized audio buffer using the chunk's start and end times (converted to sample offsets). This produces a `Float32Array` of samples for each chunk.

### Step 7: Encode to Target Format

Encode each chunk's PCM samples to the configured output format:

- **WAV**: Write a standard WAV file header (RIFF/WAVE, PCM format, 16-bit integer samples) followed by the PCM data converted from Float32 to Int16. This is performed by a built-in WAV encoder with no external dependencies.
- **MP3**: Encode via `ffmpeg` (spawning a process with PCM input piped to stdin). If `ffmpeg` is not available and `lamejs` is installed, use `lamejs` as a pure-JavaScript fallback.
- **FLAC**: Encode via `ffmpeg`. No pure-JavaScript fallback.
- **OGG/Opus**: Encode via `ffmpeg`. No pure-JavaScript fallback.

The encoded data is stored as a `Buffer` in each `AudioChunk` object.

### Edge Cases

**No silence found (continuous speech):** If the audio contains no silence gaps (or all gaps are shorter than `minSilenceDuration`), the chunker has no natural split points. It falls back to progressively reducing `minSilenceDuration` (halving it until gaps are found) and, as a last resort, force-splits at the duration limit. Force-split chunks carry `forceSplit: true` in their metadata.

**Very long silence:** A silence gap lasting several minutes (e.g., a paused recording) is split in the middle. The silence before the midpoint belongs to the preceding chunk; the silence after belongs to the following chunk. This prevents one chunk from containing an excessive amount of silence.

**Very short utterances:** Isolated short speech segments (a single word, a cough) that are shorter than `minSpeechDuration` are discarded by the VAD merging step. Speech segments that pass the duration filter but are very short are grouped with their neighbors into the same chunk rather than becoming standalone tiny chunks.

**Empty audio:** If the input audio is empty (zero-length file or buffer), return an empty array with no chunks.

**Audio with no speech:** If VAD detects no speech in the entire audio, return a single chunk containing the full audio with `noSpeechDetected: true` in metadata. The caller decides whether to submit it for transcription.

---

## 7. Size and Duration Limits

### File Size Estimation

Before finalizing a chunk, `audio-chunker` estimates the encoded file size to ensure it fits within the configured maximum. The estimation uses format-specific formulas:

**WAV (uncompressed PCM):**
```
fileSize = headerSize + (duration * sampleRate * channels * bytesPerSample)
headerSize = 44 bytes (standard WAV header)
bytesPerSample = 2 (16-bit PCM)
```

For 16 kHz mono 16-bit WAV:
```
fileSize = 44 + (duration * 16000 * 1 * 2) = 44 + (duration * 32000)
```

One minute of audio = 1.92 MB. The 25 MB Whisper limit allows approximately 13 minutes per WAV chunk.

**MP3 (compressed):**
```
fileSize ≈ (bitrate / 8) * duration
```

At 128 kbps: one minute = 0.96 MB. The 25 MB limit allows approximately 26 minutes per MP3 chunk. At 64 kbps (sufficient for speech): one minute = 0.48 MB, allowing approximately 52 minutes per chunk.

**FLAC (lossless compressed):**
```
fileSize ≈ duration * sampleRate * channels * bytesPerSample * compressionRatio
compressionRatio ≈ 0.5 - 0.7 (speech typically compresses well)
```

For 16 kHz mono FLAC: approximately 1.0-1.3 MB per minute. The 25 MB limit allows approximately 19-25 minutes per chunk.

**OGG/Opus (compressed):**
```
fileSize ≈ (bitrate / 8) * duration
```

At 32 kbps (high quality for speech): one minute = 0.24 MB. The 25 MB limit allows approximately 104 minutes per chunk.

### Estimation vs. Actual Size

Compressed formats (MP3, FLAC, OGG) have variable compression ratios that depend on the audio content. Speech compresses better than music; silence compresses better than speech. The size estimation uses conservative compression ratios (worst case for the content type) to avoid exceeding the limit. After encoding, the actual file size is checked. If it exceeds the limit (rare, due to conservative estimation), the chunk is re-split at a finer boundary and re-encoded.

### Size Limit Presets

Callers can specify size limits as byte values or as preset strings:

```typescript
// Byte value
chunk(audio, { maxFileSize: 26_214_400 }); // 25 MB in bytes

// String preset
chunk(audio, { maxFileSize: '25mb' });  // OpenAI Whisper
chunk(audio, { maxFileSize: '10mb' });  // Google Speech-to-Text sync
chunk(audio, { maxFileSize: '2gb' });   // AWS Transcribe
```

### Duration Limits

Duration limits are specified in seconds:

```typescript
chunk(audio, { maxDuration: 300 });    // 5 minutes per chunk
chunk(audio, { maxDuration: 1800 });   // 30 minutes per chunk
```

When both `maxFileSize` and `maxDuration` are specified, the more restrictive limit applies. A chunk ends at whichever limit is reached first.

### Iterative Re-Splitting

When a chunk exceeds the file size limit after encoding (due to inaccurate compression ratio estimation), the chunker does not fail. Instead, it re-splits the oversized chunk:

1. Find the silence gap closest to the midpoint of the chunk.
2. Split at that gap, producing two sub-chunks.
3. Encode each sub-chunk and check the size.
4. If either sub-chunk still exceeds the limit, recurse.

This iterative approach guarantees that all output chunks fit within the size limit, at the cost of potentially producing more chunks than the initial estimate.

---

## 8. Overlap

### How Overlap Works

Overlap duplicates audio at chunk boundaries. When `overlapDuration` is set to 1.0 seconds and a chunk boundary falls at time T:

- Chunk N contains audio from its start to T + 0.5s.
- Chunk N+1 contains audio from T - 0.5s to its end.
- The region from T - 0.5s to T + 0.5s appears in both chunks.

The overlap is centered on the split point (the midpoint of the silence gap). If the silence gap is shorter than the overlap duration, the overlap region is capped to the gap boundaries -- audio is never duplicated from within a speech segment.

### Why Overlap Matters for Transcription

Speech recognition models process audio from the beginning of the input to the end. At the very start and end of an audio segment, the model has less temporal context, which can reduce accuracy for words near the boundaries. Overlap ensures that words near a split point have full context in at least one chunk. The word "authentication" spoken at the boundary between chunk 3 and chunk 4 will be fully captured in whichever chunk contains it with sufficient surrounding context.

The transcription of overlapping regions will produce duplicate text. For example, if the overlap region contains the phrase "please hold," both chunk N and chunk N+1 will transcribe "please hold." Downstream deduplication is required to produce clean, non-duplicated transcription. `audio-chunker` provides the overlap timing metadata (`overlapStart`, `overlapEnd`, `overlapDuration`) that deduplication logic needs to identify the overlapping text.

### Overlap Configuration

```typescript
// Default: 1 second overlap
chunk(audio);

// Custom overlap: 2 seconds
chunk(audio, { overlapDuration: 2.0 });

// No overlap (for non-overlapping chunks)
chunk(audio, { overlapDuration: 0 });
```

### Overlap Metadata

Each chunk carries overlap information in its metadata:

```typescript
interface AudioChunkMetadata {
  // ... other fields

  /** Duration of overlap at the start of this chunk (seconds).
   *  Audio from this region also appears at the end of the previous chunk.
   *  Zero for the first chunk. */
  overlapBefore: number;

  /** Duration of overlap at the end of this chunk (seconds).
   *  Audio from this region also appears at the start of the next chunk.
   *  Zero for the last chunk. */
  overlapAfter: number;
}
```

---

## 9. Format Conversion

### Input Formats

`audio-chunker` accepts audio in the following formats:

| Format | Extension | Detection | Decoder |
|--------|-----------|-----------|---------|
| WAV (PCM) | `.wav` | RIFF header magic bytes | Built-in WAV parser |
| MP3 | `.mp3` | ID3 tag or MPEG sync word | `ffmpeg` |
| FLAC | `.flac` | fLaC magic bytes | `ffmpeg` |
| OGG (Vorbis/Opus) | `.ogg`, `.opus` | OggS magic bytes | `ffmpeg` |
| WebM (Opus/Vorbis) | `.webm` | EBML/WebM header | `ffmpeg` |
| Raw PCM | N/A | Caller specifies format | Direct (caller provides sample rate, channels, bit depth) |
| M4A/AAC | `.m4a`, `.aac` | ftyp/AAAA magic bytes | `ffmpeg` |

Format detection uses magic bytes (the first 4-12 bytes of the file) rather than file extensions, ensuring correct identification even when extensions are missing or wrong.

For non-WAV formats, `ffmpeg` is required. If `ffmpeg` is not installed and the input is not WAV, `audio-chunker` throws a `FfmpegNotFoundError` with a message explaining how to install `ffmpeg`.

### Output Formats

| Format | Extension | Encoder | Use Case |
|--------|-----------|---------|----------|
| WAV (default) | `.wav` | Built-in (no dependencies) | Widest API compatibility, no quality loss |
| MP3 | `.mp3` | `ffmpeg` or `lamejs` fallback | Smaller files when file size is the primary constraint |
| FLAC | `.flac` | `ffmpeg` | Lossless compression, smaller than WAV, supported by Google Speech-to-Text |
| OGG/Opus | `.ogg` | `ffmpeg` | Most efficient compression for speech, supported by Google Speech-to-Text |

### Sample Rate Conversion

Speech recognition APIs are optimized for specific sample rates. Whisper accepts any sample rate but internally resamples to 16 kHz. Google Speech-to-Text accepts 8-48 kHz but recommends 16 kHz for wideband speech. Sending audio at a higher sample rate than necessary wastes file size without improving transcription quality.

`audio-chunker` resamples to a configurable target sample rate (default: 16 kHz). The resampling is performed during the decode/normalize step (Step 1 of the chunking algorithm).

**Common sample rates:**

| Rate | Use Case |
|------|----------|
| 8 kHz | Telephone audio (narrowband) |
| 16 kHz | Speech recognition standard (wideband) |
| 22.05 kHz | Low-quality audio playback |
| 44.1 kHz | CD-quality audio |
| 48 kHz | Professional audio, video production |

### Channel Conversion

Speech transcription operates on mono audio. Stereo (or multi-channel) audio is converted to mono by averaging all channels:

```
mono_sample = (channel_1_sample + channel_2_sample + ... + channel_N_sample) / N
```

For stereo meeting recordings where different speakers are on different channels, channel mixing is the correct default -- the transcription API processes all speakers together. If the caller needs per-channel transcription (e.g., a two-party phone call with one party per channel), they can pre-split the channels before passing to `audio-chunker`.

---

## 10. Streaming Mode

### Overview

Streaming mode processes audio data that arrives incrementally rather than as a complete file. This is essential for live transcription scenarios: microphone input, WebSocket audio streams, live broadcasts, and any source where the full audio is not available upfront.

### Creating a Streaming Chunker

```typescript
import { createChunker } from 'audio-chunker';

const chunker = createChunker({
  maxFileSize: '25mb',
  maxDuration: 300,
  overlapDuration: 1.0,
  outputFormat: 'wav',
  sampleRate: 16000,
  vad: 'silero',
});
```

### Feeding Audio Data

Audio data is fed to the chunker via `write()`. The data can be raw PCM samples or encoded audio (WAV frames, WebSocket binary messages).

```typescript
// From a microphone stream (raw PCM)
microphoneStream.on('data', (pcmData: Buffer) => {
  chunker.write(pcmData);
});

// From a WebSocket (binary audio frames)
ws.on('message', (data: Buffer) => {
  chunker.write(data);
});
```

### Receiving Chunks

The chunker emits a `'chunk'` event each time a complete chunk is ready. A chunk is emitted when:

1. A silence gap of sufficient duration is detected after enough audio has accumulated.
2. The accumulated audio would exceed the `maxDuration` limit.
3. The estimated file size of the accumulated audio would exceed `maxFileSize`.

```typescript
chunker.on('chunk', (chunk: AudioChunk) => {
  console.log(`Chunk ${chunk.index}: ${chunk.startTime}s - ${chunk.endTime}s`);
  // Submit to transcription API
  await transcribe(chunk.buffer);
});
```

### Flushing

When the audio stream ends, call `end()` to flush the remaining buffered audio as a final chunk:

```typescript
microphoneStream.on('end', () => {
  chunker.end();
});

chunker.on('end', () => {
  console.log('All chunks emitted.');
});
```

### Incremental VAD

In streaming mode, VAD runs incrementally. As audio data arrives, the chunker accumulates samples into an internal buffer. When the buffer reaches a configurable analysis window (default: 1 second of audio), VAD is run on the new audio to update the speech/silence timeline. This incremental approach avoids re-processing the entire audio history on each new data chunk.

The trade-off is that VAD decisions near the analysis window boundary may be revised when more context arrives. The chunker handles this by not emitting a chunk until a silence gap is confirmed by at least one additional analysis window of audio beyond the gap. This look-ahead prevents premature splitting at brief pauses that are not true speech boundaries.

### Backpressure

If the consumer of `'chunk'` events is slower than the producer (e.g., the transcription API has high latency), chunks are queued internally. The chunker does not apply backpressure to the `write()` side -- it continues accepting data and buffering it. This is appropriate because dropping audio data would cause transcription gaps. If memory usage is a concern, the caller should manage backpressure externally (e.g., pausing the audio source when the chunk queue exceeds a threshold).

### Streaming Example

```typescript
import { createChunker } from 'audio-chunker';
import { createReadStream } from 'node:fs';

const chunker = createChunker({
  maxDuration: 60,
  overlapDuration: 1.0,
  outputFormat: 'wav',
  sampleRate: 16000,
  inputFormat: {
    encoding: 'pcm_s16le',
    sampleRate: 44100,
    channels: 2,
  },
});

const chunks: AudioChunk[] = [];

chunker.on('chunk', (chunk) => {
  chunks.push(chunk);
  console.log(`Chunk ${chunk.index}: ${chunk.duration.toFixed(1)}s, ${(chunk.byteLength / 1024).toFixed(0)} KB`);
});

chunker.on('end', () => {
  console.log(`Total chunks: ${chunks.length}`);
});

// Pipe raw PCM audio
const stream = createReadStream('./recording.raw');
stream.on('data', (data: Buffer) => chunker.write(data));
stream.on('end', () => chunker.end());
```

---

## 11. API Surface

### Installation

```bash
npm install audio-chunker
```

### Peer Dependencies

```json
{
  "peerDependencies": {
    "@ricky0123/vad-node": ">=0.0.18"
  },
  "peerDependenciesMeta": {
    "@ricky0123/vad-node": { "optional": true }
  }
}
```

`@ricky0123/vad-node` is optional. When installed, it enables the high-accuracy Silero VAD adapter. When absent, the package falls back to the energy-based VAD. The caller is warned at runtime if neither the Silero adapter nor a custom VAD function is available and the energy-based fallback is used.

`ffmpeg` must be installed on the system for non-WAV input formats and for MP3/FLAC/OGG output formats. It is not an npm dependency -- it is a system binary invoked via `child_process`. When `ffmpeg` is not found, the package works only with WAV input and WAV output.

### `chunk`

The primary function. Reads audio, runs VAD, splits into chunks, encodes, and returns.

```typescript
import { chunk } from 'audio-chunker';

const chunks = await chunk('./meeting-recording.wav', {
  maxFileSize: '25mb',
  maxDuration: 300,
  overlapDuration: 1.0,
  outputFormat: 'wav',
  sampleRate: 16000,
});

for (const c of chunks) {
  console.log(`Chunk ${c.index}: ${c.startTime.toFixed(1)}s - ${c.endTime.toFixed(1)}s (${c.duration.toFixed(1)}s)`);
  // c.buffer is a Buffer containing the encoded audio file
  await submitToWhisper(c.buffer);
}
```

**Signature:**

```typescript
function chunk(
  audio: AudioSource,
  options?: ChunkOptions,
): Promise<AudioChunk[]>;
```

### `detectSpeechSegments`

Runs VAD only, returning speech segment timestamps without chunking. Useful for analysis, visualization, or when the caller wants to implement custom chunking logic.

```typescript
import { detectSpeechSegments } from 'audio-chunker';

const segments = await detectSpeechSegments('./recording.wav', {
  vad: 'silero',
  vadOptions: { threshold: 0.5 },
});

for (const seg of segments) {
  console.log(`Speech: ${seg.start.toFixed(2)}s - ${seg.end.toFixed(2)}s`);
}
```

**Signature:**

```typescript
function detectSpeechSegments(
  audio: AudioSource,
  options?: VadOnlyOptions,
): Promise<SpeechSegment[]>;
```

### `createChunker`

Factory function for streaming mode. Returns an `AudioChunker` instance that accepts audio data incrementally and emits chunks as they complete.

```typescript
import { createChunker } from 'audio-chunker';

const chunker = createChunker({
  maxFileSize: '25mb',
  maxDuration: 60,
  overlapDuration: 1.0,
  outputFormat: 'wav',
  sampleRate: 16000,
});

chunker.on('chunk', (chunk) => { /* ... */ });
chunker.on('end', () => { /* ... */ });
chunker.on('error', (err) => { /* ... */ });

chunker.write(audioData);
chunker.end();
```

**Signature:**

```typescript
function createChunker(config: ChunkerConfig): AudioChunker;
```

### Type Definitions

```typescript
// ── Source ───────────────────────────────────────────────────────────

/** Audio input: file path, Buffer, or Uint8Array. */
type AudioSource = string | Buffer | Uint8Array;

// ── Speech Segments ─────────────────────────────────────────────────

/** A contiguous region of detected speech. */
interface SpeechSegment {
  /** Start time in seconds from the beginning of the audio. */
  start: number;

  /** End time in seconds from the beginning of the audio. */
  end: number;
}

// ── VAD ─────────────────────────────────────────────────────────────

/** A function that detects speech segments in audio. */
type VadFunction = (
  audio: Float32Array,
  sampleRate: number,
) => Promise<SpeechSegment[]>;

/** Silero VAD configuration. */
interface SileroVadOptions {
  /** Speech probability threshold (0.0 - 1.0). Default: 0.5. */
  threshold?: number;

  /** Minimum silence duration in ms to consider a gap. Default: 500. */
  minSilenceDurationMs?: number;

  /** Minimum speech duration in ms. Shorter segments are discarded. Default: 250. */
  minSpeechDurationMs?: number;

  /** Padding in ms added before/after speech segments. Default: 100. */
  speechPadMs?: number;
}

/** Energy-based VAD configuration. */
interface EnergyVadOptions {
  /** RMS energy threshold for speech detection. Default: 0.01. */
  threshold?: number;

  /** Frame size in ms. Default: 30. */
  frameSizeMs?: number;

  /** Frame hop size in ms. Default: 15. */
  hopSizeMs?: number;
}

// ── Audio Format ────────────────────────────────────────────────────

/** Supported output audio formats. */
type OutputFormat = 'wav' | 'mp3' | 'flac' | 'ogg';

/** Raw PCM input format descriptor. */
interface RawPcmFormat {
  /** PCM encoding. */
  encoding: 'pcm_f32le' | 'pcm_s16le' | 'pcm_s16be' | 'pcm_u8';

  /** Sample rate in Hz. */
  sampleRate: number;

  /** Number of channels. */
  channels: number;
}

// ── Chunk Output ────────────────────────────────────────────────────

/** A single audio chunk produced by the chunker. */
interface AudioChunk {
  /** Encoded audio data as a Buffer (a valid audio file in the output format). */
  buffer: Buffer;

  /** Output audio format. */
  format: OutputFormat;

  /** Zero-based sequential index of this chunk. */
  index: number;

  /** Start time in seconds relative to the original audio. */
  startTime: number;

  /** End time in seconds relative to the original audio. */
  endTime: number;

  /** Duration of this chunk in seconds. */
  duration: number;

  /** Sample rate of this chunk in Hz. */
  sampleRate: number;

  /** Number of channels in this chunk (always 1 for mono output). */
  channels: number;

  /** Size of the encoded audio buffer in bytes. */
  byteLength: number;

  /** Number of speech segments detected within this chunk. */
  speechSegmentCount: number;

  /** Metadata about overlap regions. */
  overlap: {
    /** Duration of overlap at the start of this chunk (seconds). Zero for first chunk. */
    before: number;

    /** Duration of overlap at the end of this chunk (seconds). Zero for last chunk. */
    after: number;
  };

  /** True if this chunk was produced by force-splitting continuous speech
   *  (no suitable silence gap was found). */
  forceSplit: boolean;

  /** True if VAD detected no speech in the entire source audio. */
  noSpeechDetected: boolean;
}

// ── Options ─────────────────────────────────────────────────────────

/** Options for the chunk() function. */
interface ChunkOptions {
  /**
   * Maximum file size per chunk. Can be a number (bytes) or a string
   * with unit ('25mb', '10mb', '2gb').
   * Default: '25mb' (OpenAI Whisper limit).
   */
  maxFileSize?: number | string;

  /**
   * Maximum duration per chunk in seconds.
   * Default: Infinity (no duration limit; size limit governs).
   */
  maxDuration?: number;

  /**
   * Overlap duration in seconds at chunk boundaries.
   * Default: 1.0.
   */
  overlapDuration?: number;

  /**
   * Output audio format.
   * Default: 'wav'.
   */
  outputFormat?: OutputFormat;

  /**
   * Output sample rate in Hz.
   * Default: 16000 (16 kHz, standard for speech recognition).
   */
  sampleRate?: number;

  /**
   * Output channel count. 1 for mono (default), 2 for stereo.
   * Default: 1.
   */
  channels?: number;

  /**
   * VAD function or preset name.
   * - 'silero': Use Silero VAD (requires @ricky0123/vad-node).
   * - 'energy': Use energy-based VAD (zero dependencies).
   * - VadFunction: Custom VAD function.
   * Default: 'silero' if available, otherwise 'energy'.
   */
  vad?: 'silero' | 'energy' | VadFunction;

  /**
   * VAD-specific options. Interpreted based on the selected VAD.
   */
  vadOptions?: SileroVadOptions | EnergyVadOptions;

  /**
   * Minimum silence duration in milliseconds for a gap to qualify
   * as a chunk split point.
   * Default: 500.
   */
  minSilenceDuration?: number;

  /**
   * Minimum speech segment duration in milliseconds. Segments shorter
   * than this are discarded by VAD post-processing.
   * Default: 250.
   */
  minSpeechDuration?: number;

  /**
   * MP3 encoding bitrate in kbps. Only used when outputFormat is 'mp3'.
   * Default: 64 (sufficient for speech).
   */
  mp3Bitrate?: number;

  /**
   * Input format descriptor for raw PCM input. Required when the input
   * is raw PCM data (no file header).
   */
  inputFormat?: RawPcmFormat;

  /**
   * AbortSignal for cancellation.
   */
  signal?: AbortSignal;
}

/** Options for detectSpeechSegments(). */
interface VadOnlyOptions {
  /** VAD function or preset name. */
  vad?: 'silero' | 'energy' | VadFunction;

  /** VAD-specific options. */
  vadOptions?: SileroVadOptions | EnergyVadOptions;

  /** Minimum silence duration for segment merging (ms). Default: 500. */
  minSilenceDuration?: number;

  /** Minimum speech segment duration (ms). Default: 250. */
  minSpeechDuration?: number;

  /** Input sample rate for raw PCM input. */
  sampleRate?: number;

  /** Input format descriptor for raw PCM input. */
  inputFormat?: RawPcmFormat;

  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

/** Configuration for createChunker() streaming mode. */
interface ChunkerConfig extends ChunkOptions {
  /**
   * Input format descriptor. Required for streaming mode because the
   * chunker cannot detect format from raw data chunks.
   */
  inputFormat: RawPcmFormat;
}

// ── Streaming Chunker ───────────────────────────────────────────────

/** Event-based audio chunker for streaming mode. */
interface AudioChunker {
  /** Feed audio data to the chunker. */
  write(data: Buffer | Uint8Array): void;

  /** Signal that no more audio data will arrive.
   *  Flushes the remaining buffered audio as a final chunk. */
  end(): void;

  /** Register an event handler. */
  on(event: 'chunk', handler: (chunk: AudioChunk) => void): this;
  on(event: 'end', handler: () => void): this;
  on(event: 'error', handler: (error: Error) => void): this;

  /** Remove an event handler. */
  off(event: string, handler: (...args: unknown[]) => void): this;

  /** The total duration of audio processed so far, in seconds. */
  readonly processedDuration: number;

  /** The number of chunks emitted so far. */
  readonly chunkCount: number;
}
```

### Example: Basic File Chunking for Whisper

```typescript
import { chunk } from 'audio-chunker';

const chunks = await chunk('./podcast-episode.mp3', {
  maxFileSize: '25mb',
  outputFormat: 'wav',
  sampleRate: 16000,
  overlapDuration: 1.0,
});

console.log(`Split into ${chunks.length} chunks`);

for (const c of chunks) {
  const transcription = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file: new File([c.buffer], `chunk-${c.index}.wav`, { type: 'audio/wav' }),
  });
  console.log(`[${c.startTime.toFixed(1)}s] ${transcription.text}`);
}
```

### Example: Streaming Microphone Input

```typescript
import { createChunker } from 'audio-chunker';

const chunker = createChunker({
  maxDuration: 30,
  overlapDuration: 0.5,
  outputFormat: 'wav',
  sampleRate: 16000,
  inputFormat: {
    encoding: 'pcm_s16le',
    sampleRate: 16000,
    channels: 1,
  },
});

chunker.on('chunk', async (chunk) => {
  const result = await transcribe(chunk.buffer);
  displayTranscription(result.text, chunk.startTime);
});

// Connect to microphone
microphone.on('data', (data) => chunker.write(data));
microphone.on('stop', () => chunker.end());
```

### Example: Custom VAD Function

```typescript
import { chunk } from 'audio-chunker';

// Use pre-computed speech segments from an external tool
const precomputedSegments = [
  { start: 0.0, end: 12.5 },
  { start: 14.2, end: 28.7 },
  { start: 30.1, end: 45.3 },
];

const customVad = async (_audio: Float32Array, _sampleRate: number) => {
  return precomputedSegments;
};

const chunks = await chunk('./recording.wav', {
  vad: customVad,
  maxFileSize: '25mb',
});
```

---

## 12. Chunk Metadata

Every chunk carries metadata describing its temporal position, content, and relationship to adjacent chunks. This metadata enables downstream systems to reassemble transcriptions, deduplicate overlapping text, and provide time-aligned output.

### Sequential Index

`chunk.index` is a zero-based integer indicating this chunk's position in the output array. The first chunk has index 0. Used for ordering, file naming, and transcription reassembly.

### Temporal Position

`chunk.startTime` and `chunk.endTime` are floating-point numbers representing the chunk's position in seconds relative to the beginning of the original audio. These include overlap regions -- `startTime` may be earlier than the chunk's "core" content due to start overlap, and `endTime` may be later due to end overlap.

`chunk.duration` is `endTime - startTime`. This is the total duration of the chunk including overlap, not the duration of unique (non-overlapping) content.

### Overlap Information

`chunk.overlap.before` indicates how many seconds of audio at the start of this chunk are duplicated from the end of the previous chunk. Zero for the first chunk.

`chunk.overlap.after` indicates how many seconds of audio at the end of this chunk are duplicated at the start of the next chunk. Zero for the last chunk.

These values enable downstream systems to identify and deduplicate the overlapping portions of transcription text.

### Speech Segment Count

`chunk.speechSegmentCount` is the number of VAD-detected speech segments contained within this chunk. A chunk may contain one continuous speech segment or multiple segments separated by short pauses. This count is informational -- it helps the caller understand the density of speech in the chunk.

### Format and Encoding

`chunk.format` is the output audio format ('wav', 'mp3', 'flac', 'ogg'). `chunk.sampleRate` is the sample rate in Hz. `chunk.channels` is the channel count (typically 1 for mono). `chunk.byteLength` is the size of the encoded audio buffer in bytes.

### Force Split Flag

`chunk.forceSplit` is `true` when the chunk was produced by force-splitting continuous speech because no suitable silence gap was found. This warns the caller that the chunk boundary may fall in the middle of a word or sentence, and the transcription at the boundary may be incomplete or garbled. Overlap mitigates this but does not eliminate it entirely.

### No Speech Detected Flag

`chunk.noSpeechDetected` is `true` when VAD detected no speech in the entire source audio and the chunk contains the full audio. This allows the caller to skip transcription for silence-only recordings.

---

## 13. Configuration

### Default Values

| Option | Default | Description |
|--------|---------|-------------|
| `maxFileSize` | `'25mb'` | Maximum encoded file size per chunk. |
| `maxDuration` | `Infinity` | Maximum duration per chunk in seconds. |
| `overlapDuration` | `1.0` | Overlap duration in seconds at chunk boundaries. |
| `outputFormat` | `'wav'` | Output audio format. |
| `sampleRate` | `16000` | Output sample rate in Hz. |
| `channels` | `1` | Output channel count (mono). |
| `vad` | `'silero'` (if available) | VAD implementation. Falls back to `'energy'`. |
| `minSilenceDuration` | `500` | Minimum silence gap (ms) for chunk splitting. |
| `minSpeechDuration` | `250` | Minimum speech segment duration (ms). |
| `mp3Bitrate` | `64` | MP3 encoding bitrate in kbps. |
| `vadOptions.threshold` | `0.5` (Silero) / `0.01` (energy) | VAD sensitivity threshold. |
| `vadOptions.speechPadMs` | `100` | Padding before/after speech segments (Silero). |

### Configuration Precedence

When using `createChunker`, options are set at creation time and cannot be changed after. For the `chunk()` function, all options are specified per call.

### Size String Parsing

The `maxFileSize` option accepts strings with units:

| String | Bytes |
|--------|-------|
| `'1kb'` | 1,024 |
| `'1mb'` | 1,048,576 |
| `'25mb'` | 26,214,400 |
| `'1gb'` | 1,073,741,824 |
| `'2gb'` | 2,147,483,648 |

Case-insensitive. Numeric values are interpreted as bytes.

### No Configuration Files

`audio-chunker` has no configuration files, environment variables, or initialization steps. Import and call:

```typescript
import { chunk } from 'audio-chunker';
const chunks = await chunk('./audio.wav');
```

All behavior is controlled via function parameters.

---

## 14. CLI

### Installation and Invocation

```bash
# Global install
npm install -g audio-chunker
audio-chunker chunk ./recording.wav

# npx (no install)
npx audio-chunker chunk ./recording.wav --output-dir ./chunks

# Package script
# package.json: { "scripts": { "chunk-audio": "audio-chunker chunk ./audio/*.wav" } }
```

### CLI Binary Name

`audio-chunker`

### Commands

#### `audio-chunker chunk <file> [options]`

Chunks an audio file into transcription-ready segments.

```
Arguments:
  <file>                     Path to the audio file to chunk.

Chunking options:
  --max-size <size>          Maximum file size per chunk (e.g., '25mb', '10mb').
                             Default: 25mb.
  --max-duration <seconds>   Maximum duration per chunk in seconds.
                             Default: no limit.
  --overlap <seconds>        Overlap duration at chunk boundaries in seconds.
                             Default: 1.0.
  --min-silence <ms>         Minimum silence duration for split points in ms.
                             Default: 500.

Output options:
  --output-dir <path>        Write chunk files to this directory. Created if
                             it does not exist. Default: ./chunks.
  --format <format>          Output format: wav, mp3, flac, ogg.
                             Default: wav.
  --sample-rate <hz>         Output sample rate in Hz. Default: 16000.
  --json                     Output chunk metadata as JSON to stdout instead
                             of writing files.

VAD options:
  --vad <type>               VAD type: silero, energy. Default: silero.
  --vad-threshold <n>        VAD sensitivity threshold (0.0 - 1.0).
                             Default: 0.5.

General:
  --version                  Print version and exit.
  --help                     Print help and exit.
```

#### `audio-chunker detect <file> [options]`

Runs VAD on an audio file and outputs speech segment timestamps.

```
Arguments:
  <file>                     Path to the audio file.

Options:
  --vad <type>               VAD type: silero, energy. Default: silero.
  --vad-threshold <n>        VAD sensitivity threshold. Default: 0.5.
  --min-silence <ms>         Minimum silence duration for merging (ms).
                             Default: 500.
  --format <format>          Output format: json, text. Default: text.

General:
  --version                  Print version and exit.
  --help                     Print help and exit.
```

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success. Chunks written to output directory or metadata printed to stdout. |
| `1` | Processing error. Audio file could not be read, decoded, or processed. |
| `2` | Configuration error. Invalid flags, missing arguments, or unsupported format. |

### Human-Readable Output Examples

```
$ audio-chunker chunk ./podcast-ep42.mp3

  audio-chunker v0.1.0

  Input:    podcast-ep42.mp3 (87:23, 44.1 kHz stereo, 126 MB)
  VAD:      Silero (threshold: 0.5)
  Output:   WAV, 16 kHz mono, max 25 MB/chunk

  Detecting speech segments... 847 segments found (74:12 of speech)
  Chunking...

  Chunk  0:   0:00.0 -  6:32.4  (6:32.4)   1.8 MB  [  42 segments]
  Chunk  1:   6:31.4 - 13:05.1  (6:33.7)   1.8 MB  [  38 segments]
  Chunk  2:  13:04.1 - 19:47.8  (6:43.7)   1.9 MB  [  45 segments]
  ...
  Chunk 13:  80:51.2 - 87:23.0  (6:31.8)   1.8 MB  [  31 segments]

  14 chunks written to ./chunks/
```

```
$ audio-chunker detect ./meeting.wav --format text

  0:00.00 - 0:03.21  (speech)
  0:04.85 - 0:12.47  (speech)
  0:15.32 - 0:18.91  (speech)
  ...
```

```
$ audio-chunker chunk ./call.wav --json

[
  {
    "index": 0,
    "startTime": 0.0,
    "endTime": 62.3,
    "duration": 62.3,
    "byteLength": 1993600,
    "format": "wav",
    "sampleRate": 16000,
    "speechSegmentCount": 12,
    "overlap": { "before": 0, "after": 1.0 },
    "forceSplit": false,
    "file": "chunks/chunk-000.wav"
  },
  ...
]
```

---

## 15. Integration with Monorepo Packages

### Integration with `tts-queue`

`tts-queue` manages TTS audio streaming with sentence-boundary queuing. In a voice AI pipeline, `tts-queue` produces audio (text-to-speech output) and `audio-chunker` consumes audio (speech-to-text input). They operate on opposite sides of the same pipeline. A bidirectional voice AI system uses `audio-chunker` to chunk incoming user speech for transcription and `tts-queue` to stream outgoing AI speech to the user.

```typescript
import { chunk } from 'audio-chunker';
import { createTtsQueue } from 'tts-queue';

// User speaks -> audio-chunker -> transcribe -> LLM -> tts-queue -> speaker
const userChunks = await chunk(userAudioBuffer, { maxDuration: 30 });
const transcription = await transcribe(userChunks);
const response = await llm.complete(transcription);
const ttsQueue = createTtsQueue({ provider: 'openai' });
await ttsQueue.speak(response);
```

### Integration with `voice-turn`

`voice-turn` manages turn-taking in voice AI conversations -- detecting when the user has finished speaking and the AI should respond. `audio-chunker` provides the speech segment detection that `voice-turn` needs to determine end-of-turn. The `detectSpeechSegments()` function can feed `voice-turn`'s turn detection logic with precise speech/silence timing.

```typescript
import { detectSpeechSegments } from 'audio-chunker';
import { TurnManager } from 'voice-turn';

const segments = await detectSpeechSegments(audioBuffer, { vad: 'silero' });
const turnManager = new TurnManager({ endOfTurnSilence: 1500 });
turnManager.updateSpeechSegments(segments);

if (turnManager.isUserTurnComplete()) {
  // Chunk the audio and transcribe
  const chunks = await chunk(audioBuffer);
  // ...
}
```

### Integration with `stream-tokens`

`stream-tokens` aggregates streaming LLM tokens into semantic units (sentences, paragraphs). In a transcription pipeline, `audio-chunker` splits audio into chunks, each chunk is transcribed (producing text), and the transcribed text may arrive as a stream of tokens from the API. `stream-tokens` can aggregate those tokens into complete sentences for display or further processing.

```typescript
import { chunk } from 'audio-chunker';
import { createTokenAggregator } from 'stream-tokens';

const chunks = await chunk('./recording.wav');

for (const c of chunks) {
  const stream = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file: new File([c.buffer], `chunk.wav`),
    stream: true,
  });

  const aggregator = createTokenAggregator({ boundary: 'sentence' });
  for await (const token of stream) {
    const sentence = aggregator.push(token.text);
    if (sentence) console.log(`[${c.startTime}s] ${sentence}`);
  }
}
```

---

## 16. Testing Strategy

### Unit Tests

**WAV parser tests:**
- Parse valid WAV files with various bit depths (8-bit, 16-bit, 24-bit, 32-bit float).
- Parse mono and stereo WAV files.
- Parse WAV files with various sample rates (8 kHz, 16 kHz, 44.1 kHz, 48 kHz).
- Reject invalid WAV files (wrong magic bytes, truncated header, unsupported encoding).
- Extract correct sample count, duration, and channel count from header.

**WAV encoder tests:**
- Encode Float32Array samples to valid 16-bit PCM WAV.
- Verify header fields (RIFF, WAVE, fmt, data chunk sizes).
- Round-trip: decode WAV -> encode WAV -> decode again, verify samples match (within 16-bit quantization error).

**Energy VAD tests:**
- Detect speech in a synthetic signal (sine wave above threshold).
- Detect silence in a zero-amplitude signal.
- Detect speech/silence transitions in a synthetic signal with alternating regions.
- Respect `minSpeechDuration`: discard speech segments shorter than the threshold.
- Respect `minSilenceDuration`: merge adjacent speech segments separated by short silence.
- Different thresholds produce different segment counts for the same input.

**Segment merging tests:**
- Merge two adjacent segments separated by a gap shorter than `minSilenceDuration`.
- Keep two segments separate when the gap exceeds `minSilenceDuration`.
- Handle overlapping segments (merge into one).
- Handle empty input (return empty array).
- Handle single segment (return as-is).

**Size estimation tests:**
- WAV size estimation matches actual encoded size within 1% for known duration/sample-rate/channel combinations.
- MP3 size estimation is within 20% of actual encoded size (variable bitrate allowance).
- FLAC size estimation is within 30% of actual encoded size (content-dependent compression).
- Size parsing: '25mb' -> 26214400, '10mb' -> 10485760, '1gb' -> 1073741824, '500kb' -> 512000.
- Numeric values pass through as bytes.

**Overlap tests:**
- Overlap of 1.0s produces chunks where the last 0.5s of chunk N matches the first 0.5s of chunk N+1.
- First chunk has `overlap.before === 0`.
- Last chunk has `overlap.after === 0`.
- Overlap of 0.0s produces non-overlapping chunks.
- Overlap does not extend beyond silence gap boundaries.

**Chunk metadata tests:**
- Sequential index starts at 0 and increments.
- `startTime` and `endTime` are consistent with `duration`.
- `byteLength` matches `buffer.length`.
- `speechSegmentCount` reflects the number of speech segments in the chunk.
- `forceSplit` is `true` only when no silence gap was available.

### Integration Tests

**End-to-end chunking tests:**
- Chunk a known WAV file and verify chunk count, durations, and sizes.
- Chunk a file that fits within size limits: produces a single chunk.
- Chunk a file that requires splitting: produces multiple chunks, all within size limits.
- All chunks are valid audio files (can be decoded back to PCM).
- Concatenating all chunks (accounting for overlap) reconstructs audio with total duration matching the original.

**Size compliance tests:**
- No chunk exceeds `maxFileSize` (verify `chunk.byteLength <= maxFileSize` for all chunks).
- No chunk exceeds `maxDuration` (verify `chunk.duration <= maxDuration` for all chunks).
- When both limits are set, the more restrictive one governs.

**VAD integration tests:**
- Silero VAD (when available) detects speech in a real speech recording.
- Energy VAD detects speech in a clean recording with clear silence gaps.
- Custom VAD function is called with correct arguments and its results are used for chunking.
- Fallback from Silero to energy VAD when `@ricky0123/vad-node` is not installed.

**Format conversion tests:**
- WAV input -> WAV output: works without `ffmpeg`.
- MP3 input -> WAV output: works with `ffmpeg`, fails gracefully without it.
- WAV input -> MP3 output: works with `ffmpeg`.
- Sample rate conversion: 44.1 kHz input -> 16 kHz output.
- Channel conversion: stereo input -> mono output.

**Streaming mode tests:**
- Feed audio data in small chunks (e.g., 1024 bytes at a time), verify that `'chunk'` events are emitted.
- `end()` flushes remaining audio as a final chunk.
- Chunk metadata in streaming mode matches batch mode for the same input.
- Error event is emitted for invalid input format.

### CLI Tests

- `audio-chunker chunk file.wav` produces chunk files in `./chunks/`.
- `audio-chunker chunk file.wav --output-dir ./out` writes to the specified directory.
- `audio-chunker chunk file.wav --json` outputs JSON to stdout.
- `audio-chunker detect file.wav` outputs speech segments.
- Invalid file path produces exit code 1.
- Invalid flags produce exit code 2.
- `--version` prints version and exits with code 0.
- `--help` prints help and exits with code 0.

### Edge Cases to Test

- Empty audio file (zero samples): produces empty array.
- Audio with no speech (pure silence): produces single chunk with `noSpeechDetected: true`.
- Audio with no silence (continuous speech for 30 minutes): force-splits at `maxDuration` boundaries.
- Very short audio (0.1 seconds): produces single chunk.
- Audio with very long silence (10 minutes of silence in the middle): silence is split, not assigned entirely to one chunk.
- Audio with rapid speech/silence alternation (every 100 ms): segments are merged by `minSilenceDuration`.
- Mono vs. stereo input: both produce mono output.
- Various sample rates (8 kHz, 16 kHz, 22.05 kHz, 44.1 kHz, 48 kHz): all resample to target rate correctly.
- Large file (1 GB WAV): processes without running out of memory (streaming internal processing).
- Corrupted WAV header: throws `InvalidAudioError` with descriptive message.
- Non-audio file (e.g., a text file with `.wav` extension): throws `InvalidAudioError`.

### Test Framework

Tests use Vitest, matching the project's existing configuration in `package.json`.

### Test Fixtures

Test fixtures include:

- `speech-10s.wav`: 10 seconds of clear speech with pauses (for basic chunking tests).
- `silence-5s.wav`: 5 seconds of silence (for no-speech tests).
- `speech-90min.wav`: 90-minute recording (for large file and multi-chunk tests; generated synthetically).
- `continuous-speech-5min.wav`: 5 minutes of continuous speech with no pauses (for force-split tests).
- `noisy-speech-30s.wav`: 30 seconds of speech with background noise (for VAD accuracy tests).

Fixtures are generated synthetically (sine waves + silence) to avoid distributing copyrighted audio and to produce deterministic, reproducible test inputs.

---

## 17. Performance

### Design Constraints

`audio-chunker` processes audio files that can be hundreds of megabytes to several gigabytes. A 90-minute meeting recording at 44.1 kHz stereo 16-bit is approximately 950 MB. The package must handle these files without loading the entire decoded audio into memory at once and without taking minutes to process.

### Optimization Strategy

**Streaming internal processing:** For large files, the audio is decoded and processed in segments rather than loading the entire file into memory. The VAD processes audio in frames (30 ms each), and the chunker maintains only the current chunk's samples in memory, writing completed chunks to Buffers and releasing the samples.

**Efficient VAD:** The Silero VAD processes approximately 1,000x real-time (1 second of audio in ~1 ms). The energy-based VAD is even faster (~10,000x real-time). VAD is never the bottleneck.

**Format encoding via ffmpeg:** When `ffmpeg` is available, audio encoding is delegated to `ffmpeg` running as a subprocess with piped I/O. `ffmpeg` is heavily optimized for audio processing and is faster than any pure-JavaScript encoder.

**Built-in WAV encoder:** The WAV encoder writes raw PCM data with a 44-byte header. It processes data at memory bandwidth speed (gigabytes per second) with negligible overhead.

### Performance Targets

| Input | Operation | Expected Time |
|-------|-----------|---------------|
| 10s WAV (320 KB) | Chunk (Silero VAD, WAV output) | < 200 ms |
| 1 min MP3 (1 MB) | Chunk (Silero VAD, WAV output) | < 500 ms |
| 10 min WAV (19 MB) | Chunk (Silero VAD, WAV output) | < 2 s |
| 60 min WAV (115 MB) | Chunk (Silero VAD, WAV output) | < 10 s |
| 90 min MP3 (86 MB) | Chunk (Silero VAD, WAV output) | < 15 s |
| 10s WAV (320 KB) | Chunk (energy VAD, WAV output) | < 50 ms |
| 10s WAV | detectSpeechSegments only | < 100 ms |

Benchmarks assume a 2024 MacBook Pro, Node.js 22, system `ffmpeg` installed. The Silero VAD model's first invocation includes a one-time ONNX model loading cost of approximately 500 ms; subsequent invocations use the cached model.

### Memory Usage

For the `chunk()` function with file input, peak memory usage is approximately:

- The decoded PCM audio of the largest single chunk (not the entire file, due to streaming processing).
- The ONNX model for Silero VAD (~10 MB).
- The encoded output buffer of the current chunk.

For a 90-minute recording chunked into 7-minute segments at 16 kHz mono: each segment is ~13 MB of PCM data, plus ~2 MB for the WAV-encoded output buffer. Peak memory is approximately 25 MB plus the ONNX model.

For streaming mode, memory usage is bounded by the maximum chunk duration: the chunker buffers at most `maxDuration` seconds of PCM audio plus the current chunk's encoded output.

---

## 18. Dependencies

### Runtime Dependencies

| Package | Purpose |
|---------|---------|
| `fluent-ffmpeg` | Node.js wrapper for `ffmpeg`. Used for decoding non-WAV input formats and encoding non-WAV output formats. |

### Peer Dependencies

| Package | Purpose | Required |
|---------|---------|----------|
| `@ricky0123/vad-node` | Silero VAD via ONNX Runtime. High-accuracy speech detection. | Optional |

### System Dependencies

| Dependency | Purpose | Required |
|------------|---------|----------|
| `ffmpeg` | Audio decoding, encoding, resampling, and format conversion. | Optional (required for non-WAV formats) |

### Development Dependencies

| Package | Purpose |
|---------|---------|
| `typescript` | TypeScript compiler |
| `vitest` | Test runner |
| `eslint` | Linting |
| `@types/node` | Node.js type definitions |
| `@types/fluent-ffmpeg` | Type definitions for fluent-ffmpeg |

### Why This Dependency Structure

The core WAV-to-WAV chunking path (WAV input, energy VAD, WAV output) works with zero native dependencies and no system `ffmpeg`. This makes the package usable in constrained environments (serverless, containers without `ffmpeg`). The richer feature set (non-WAV formats, Silero VAD) requires optional dependencies that the caller installs based on their needs.

`fluent-ffmpeg` is a runtime dependency (not optional) because it is a lightweight JavaScript wrapper that does not include the `ffmpeg` binary. It provides the API for invoking `ffmpeg` when it is available and fails gracefully (with a descriptive error message) when it is not. Including it as a runtime dependency simplifies the code and avoids dynamic `require` patterns.

---

## 19. File Structure

```
audio-chunker/
  package.json
  tsconfig.json
  SPEC.md
  README.md
  src/
    index.ts                       -- Public API exports
    chunk.ts                       -- chunk() function, orchestration
    detect.ts                      -- detectSpeechSegments() function
    factory.ts                     -- createChunker() factory, streaming mode
    types.ts                       -- All TypeScript type definitions
    vad/
      index.ts                     -- VAD adapter selection and dispatch
      silero.ts                    -- Silero VAD adapter (@ricky0123/vad-node)
      energy.ts                    -- Energy-based VAD (built-in, zero deps)
      types.ts                     -- VAD interface types
    audio/
      index.ts                     -- Audio I/O orchestration
      decoder.ts                   -- Audio decoding (WAV parser + ffmpeg)
      encoder.ts                   -- Audio encoding (WAV writer + ffmpeg)
      wav-parser.ts                -- Built-in WAV file parser
      wav-writer.ts                -- Built-in WAV file writer
      resampler.ts                 -- Sample rate conversion
      channel-mixer.ts             -- Stereo-to-mono conversion
      format-detect.ts             -- Input format detection (magic bytes)
    chunking/
      index.ts                     -- Chunking algorithm orchestration
      split-points.ts              -- Candidate split point identification
      grouper.ts                   -- Speech segment grouping into chunks
      overlap.ts                   -- Overlap application logic
      size-estimator.ts            -- Encoded file size estimation
    util/
      size-parser.ts               -- '25mb' string to bytes parser
      time.ts                      -- Time/sample offset conversions
    cli.ts                         -- CLI entry point
  src/__tests__/
    chunk.test.ts                  -- Main chunk() function tests
    detect.test.ts                 -- detectSpeechSegments() tests
    factory.test.ts                -- createChunker() streaming mode tests
    vad/
      energy.test.ts               -- Energy VAD tests
      silero.test.ts               -- Silero VAD adapter tests
    audio/
      wav-parser.test.ts           -- WAV parser tests
      wav-writer.test.ts           -- WAV writer tests
      resampler.test.ts            -- Resampler tests
      format-detect.test.ts        -- Format detection tests
    chunking/
      split-points.test.ts         -- Split point identification tests
      grouper.test.ts              -- Segment grouping tests
      overlap.test.ts              -- Overlap logic tests
      size-estimator.test.ts       -- Size estimation tests
    util/
      size-parser.test.ts          -- Size string parsing tests
    cli.test.ts                    -- CLI integration tests
    fixtures/
      speech-10s.wav               -- 10s speech with pauses
      silence-5s.wav               -- 5s silence
      tone-alternating.wav         -- Alternating tone/silence for VAD tests
  dist/                            -- Compiled output (generated by tsc)
```

---

## 20. Implementation Roadmap

### Phase 1: Core Audio Pipeline (v0.1.0)

Implement the foundation: types, WAV parsing/encoding, energy VAD, and basic chunking for WAV-to-WAV workflows.

1. **Types**: Define all TypeScript types in `types.ts` -- `AudioChunk`, `SpeechSegment`, `ChunkOptions`, `VadFunction`, `AudioSource`, `OutputFormat`, and all option interfaces.
2. **WAV parser**: Implement WAV file parsing in `audio/wav-parser.ts`. Read RIFF headers, extract PCM data as `Float32Array`, handle 16-bit and 32-bit float formats, mono and stereo.
3. **WAV writer**: Implement WAV file encoding in `audio/wav-writer.ts`. Write valid 16-bit PCM WAV files from `Float32Array` samples.
4. **Resampler**: Implement sample rate conversion in `audio/resampler.ts`. Linear interpolation for initial version.
5. **Channel mixer**: Implement stereo-to-mono conversion in `audio/channel-mixer.ts`.
6. **Energy VAD**: Implement the RMS energy-based VAD in `vad/energy.ts`.
7. **Segment merging**: Implement `minSilenceDuration` and `minSpeechDuration` filtering.
8. **Split point identification**: Implement candidate split point detection in `chunking/split-points.ts`.
9. **Segment grouping**: Implement speech segment grouping respecting size and duration limits in `chunking/grouper.ts`.
10. **Size estimator**: Implement WAV file size estimation in `chunking/size-estimator.ts`.
11. **Overlap**: Implement overlap application in `chunking/overlap.ts`.
12. **chunk() function**: Wire everything together in `chunk.ts`. Export from `index.ts`.
13. **detectSpeechSegments()**: Implement in `detect.ts`. Export from `index.ts`.
14. **Size parser**: Implement '25mb' string parsing in `util/size-parser.ts`.
15. **Tests**: Unit tests for WAV parser, WAV writer, resampler, energy VAD, segment merging, split points, grouping, overlap, and size estimation. Integration test for end-to-end WAV chunking.

### Phase 2: Silero VAD and Format Support (v0.2.0)

Add high-accuracy VAD and multi-format support via `ffmpeg`.

1. **Silero VAD adapter**: Implement the `@ricky0123/vad-node` wrapper in `vad/silero.ts`. Handle optional dependency loading with graceful fallback.
2. **VAD auto-selection**: Implement VAD adapter selection (Silero if available, energy fallback) in `vad/index.ts`.
3. **Format detection**: Implement magic byte-based format detection in `audio/format-detect.ts`.
4. **ffmpeg decoder**: Implement audio decoding via `fluent-ffmpeg` in `audio/decoder.ts`. Handle MP3, FLAC, OGG, WebM, M4A input.
5. **ffmpeg encoder**: Implement audio encoding via `fluent-ffmpeg` in `audio/encoder.ts`. Handle MP3, FLAC, OGG output.
6. **Size estimation for compressed formats**: Extend `chunking/size-estimator.ts` with MP3, FLAC, OGG estimation.
7. **Tests**: Silero VAD tests, format detection tests, ffmpeg integration tests (when ffmpeg is available), compressed format size estimation tests.

### Phase 3: Streaming Mode and CLI (v0.3.0)

Add real-time streaming support and the command-line interface.

1. **createChunker()**: Implement the streaming chunker factory in `factory.ts`. Internal buffering, incremental VAD, event emission.
2. **Streaming VAD**: Implement incremental VAD processing (run VAD on new data as it arrives, maintain segment state across calls).
3. **CLI**: Implement CLI argument parsing (`chunk` and `detect` commands), file I/O, directory creation, JSON output, and human-readable output in `cli.ts`.
4. **CLI tests**: End-to-end CLI integration tests.
5. **Tests**: Streaming mode tests (incremental data feeding, chunk event emission, end flushing).

### Phase 4: Polish and Production Readiness (v1.0.0)

1. **Performance optimization**: Streaming internal processing for large files, memory usage profiling, benchmark suite.
2. **Edge case hardening**: All edge cases from the testing strategy (empty audio, no speech, continuous speech, very long silence, corrupted files).
3. **Error messages**: Descriptive error messages for all failure modes (file not found, ffmpeg not installed, unsupported format, corrupted audio).
4. **Documentation**: Comprehensive README with examples for every common use case.

---

## 21. Example Use Cases

### 21.1 Podcast Transcription Pipeline

A podcast platform transcribes episodes for searchable show notes. Episodes are 30-120 minutes, recorded at 44.1 kHz stereo, and stored as MP3 files.

```typescript
import { chunk } from 'audio-chunker';
import OpenAI from 'openai';

const openai = new OpenAI();

async function transcribePodcast(episodePath: string): Promise<string> {
  // Chunk the episode into Whisper-compatible segments
  const chunks = await chunk(episodePath, {
    maxFileSize: '25mb',
    outputFormat: 'wav',
    sampleRate: 16000,
    overlapDuration: 1.5, // generous overlap for word boundary safety
  });

  console.log(`Episode split into ${chunks.length} chunks`);

  // Transcribe each chunk
  const transcriptions: string[] = [];
  for (const c of chunks) {
    const result = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file: new File([c.buffer], `chunk-${c.index}.wav`, { type: 'audio/wav' }),
      language: 'en',
    });
    transcriptions.push(result.text);
    console.log(`Chunk ${c.index} (${c.startTime.toFixed(0)}s-${c.endTime.toFixed(0)}s): ${result.text.substring(0, 80)}...`);
  }

  // Join transcriptions (overlap deduplication left to downstream processing)
  return transcriptions.join(' ');
}
```

### 21.2 Meeting Recording Chunking

A meeting recording application processes Zoom recordings for searchable archives.

```typescript
import { chunk } from 'audio-chunker';

const chunks = await chunk('./zoom-meeting-2024-01-15.m4a', {
  maxFileSize: '25mb',
  maxDuration: 300, // 5-minute chunks for parallel processing
  outputFormat: 'mp3',
  mp3Bitrate: 64,
  sampleRate: 16000,
  overlapDuration: 1.0,
  vad: 'silero',
  vadOptions: { threshold: 0.4 }, // lower threshold to catch quiet speakers
});

// Process chunks in parallel
const results = await Promise.all(
  chunks.map(async (c) => ({
    chunk: c,
    text: await transcribe(c.buffer),
  })),
);

// Build time-aligned transcript
for (const { chunk: c, text } of results) {
  console.log(`[${formatTime(c.startTime)} - ${formatTime(c.endTime)}]`);
  console.log(text);
  console.log();
}
```

### 21.3 Call Center Audio Processing

A call center quality team processes thousands of recorded calls daily.

```typescript
import { chunk } from 'audio-chunker';
import { readdir } from 'node:fs/promises';

const callFiles = await readdir('./calls/2024-01-15/');

for (const file of callFiles) {
  const chunks = await chunk(`./calls/2024-01-15/${file}`, {
    maxFileSize: '10mb', // smaller chunks for faster processing
    outputFormat: 'flac', // lossless, smaller than WAV
    sampleRate: 8000, // telephone audio is narrowband
    overlapDuration: 0.5,
    minSilenceDuration: 300, // shorter silence gaps in conversations
  });

  console.log(`${file}: ${chunks.length} chunks, total ${chunks.reduce((sum, c) => sum + c.duration, 0).toFixed(0)}s`);

  // Submit for batch transcription
  await queueForTranscription(file, chunks);
}
```

### 21.4 Live Streaming Transcription

A webinar platform provides live captions using streaming chunking.

```typescript
import { createChunker } from 'audio-chunker';
import WebSocket from 'ws';

const ws = new WebSocket('wss://webinar.example.com/audio-stream');

const chunker = createChunker({
  maxDuration: 15, // short chunks for low-latency transcription
  overlapDuration: 0.5,
  outputFormat: 'wav',
  sampleRate: 16000,
  inputFormat: {
    encoding: 'pcm_s16le',
    sampleRate: 48000,
    channels: 1,
  },
  vad: 'silero',
});

chunker.on('chunk', async (chunk) => {
  const transcription = await transcribe(chunk.buffer);
  broadcastCaption({
    text: transcription.text,
    startTime: chunk.startTime,
    endTime: chunk.endTime,
  });
});

ws.on('message', (data: Buffer) => {
  chunker.write(data);
});

ws.on('close', () => {
  chunker.end();
});
```

### 21.5 Speech Segment Analysis

A researcher analyzes speech patterns in interview recordings, using VAD detection without chunking.

```typescript
import { detectSpeechSegments } from 'audio-chunker';

const segments = await detectSpeechSegments('./interview.wav', {
  vad: 'silero',
  vadOptions: { threshold: 0.5 },
  minSilenceDuration: 200,
});

const totalSpeech = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
const totalDuration = 3600; // 1-hour interview

console.log(`Speech: ${totalSpeech.toFixed(1)}s (${(totalSpeech / totalDuration * 100).toFixed(1)}%)`);
console.log(`Silence: ${(totalDuration - totalSpeech).toFixed(1)}s`);
console.log(`Segments: ${segments.length}`);
console.log(`Average segment duration: ${(totalSpeech / segments.length).toFixed(1)}s`);

// Find the longest pause
let longestPause = 0;
for (let i = 1; i < segments.length; i++) {
  const pause = segments[i].start - segments[i - 1].end;
  longestPause = Math.max(longestPause, pause);
}
console.log(`Longest pause: ${longestPause.toFixed(1)}s`);
```

### 21.6 CLI Batch Processing

Chunking a directory of audio files from the command line for batch transcription.

```bash
# Chunk all MP3 files in a directory
for f in recordings/*.mp3; do
  audio-chunker chunk "$f" \
    --output-dir "chunks/$(basename "$f" .mp3)" \
    --max-size 25mb \
    --format wav \
    --sample-rate 16000 \
    --overlap 1.0
done

# Get chunk metadata as JSON for pipeline integration
audio-chunker chunk podcast.mp3 --json > podcast-chunks.json

# Analyze speech patterns in a recording
audio-chunker detect meeting.wav --format json > speech-segments.json
```
