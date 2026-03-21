/**
 * Parse a file size string (e.g., '25mb', '10MB', '1gb', '500kb') to bytes.
 * Also accepts a raw number (treated as bytes).
 */
export function parseSize(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) {
      throw new Error(`Invalid size: ${input}. Must be a non-negative finite number.`);
    }
    return Math.floor(input);
  }

  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new Error(`Invalid size: "${input}". Expected a string like '25mb' or a number.`);
  }

  const trimmed = input.trim().toLowerCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)$/);

  if (!match) {
    throw new Error(
      `Invalid size format: "${input}". Expected a string like '25mb', '10kb', '1gb', or '500b'.`,
    );
  }

  const value = parseFloat(match[1]);
  const unit = match[2];

  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
    tb: 1024 * 1024 * 1024 * 1024,
  };

  const bytes = Math.floor(value * multipliers[unit]);

  if (bytes < 0) {
    throw new Error(`Invalid size: "${input}". Size must be non-negative.`);
  }

  return bytes;
}

/**
 * Estimate the encoded file size of a WAV chunk given its duration and audio properties.
 *
 * @param durationMs - Duration in milliseconds
 * @param sampleRate - Sample rate in Hz
 * @param channels - Number of channels
 * @param bitDepth - Bits per sample (default: 16)
 * @returns Estimated file size in bytes
 */
export function estimateWavSize(
  durationMs: number,
  sampleRate: number,
  channels: number,
  bitDepth: number = 16,
): number {
  const headerSize = 44;
  const bytesPerSample = bitDepth / 8;
  const durationSec = durationMs / 1000;
  const dataSize = Math.ceil(durationSec * sampleRate * channels * bytesPerSample);
  return headerSize + dataSize;
}
