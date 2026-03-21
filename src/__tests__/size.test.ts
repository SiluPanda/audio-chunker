import { describe, it, expect } from 'vitest';
import { parseSize, estimateWavSize } from '../size';

describe('parseSize', () => {
  describe('numeric input', () => {
    it('should accept a number as bytes', () => {
      expect(parseSize(1024)).toBe(1024);
    });

    it('should accept zero', () => {
      expect(parseSize(0)).toBe(0);
    });

    it('should floor decimal numbers', () => {
      expect(parseSize(1024.7)).toBe(1024);
    });

    it('should accept large numbers', () => {
      expect(parseSize(26214400)).toBe(26214400);
    });

    it('should throw for negative numbers', () => {
      expect(() => parseSize(-1)).toThrow('Invalid size');
    });

    it('should throw for NaN', () => {
      expect(() => parseSize(NaN)).toThrow('Invalid size');
    });

    it('should throw for Infinity', () => {
      expect(() => parseSize(Infinity)).toThrow('Invalid size');
    });
  });

  describe('string input', () => {
    it('should parse bytes (b)', () => {
      expect(parseSize('100b')).toBe(100);
    });

    it('should parse kilobytes (kb)', () => {
      expect(parseSize('1kb')).toBe(1024);
    });

    it('should parse megabytes (mb)', () => {
      expect(parseSize('25mb')).toBe(25 * 1024 * 1024);
    });

    it('should parse gigabytes (gb)', () => {
      expect(parseSize('1gb')).toBe(1024 * 1024 * 1024);
    });

    it('should parse terabytes (tb)', () => {
      expect(parseSize('1tb')).toBe(1024 * 1024 * 1024 * 1024);
    });

    it('should be case-insensitive', () => {
      expect(parseSize('25MB')).toBe(25 * 1024 * 1024);
      expect(parseSize('25Mb')).toBe(25 * 1024 * 1024);
      expect(parseSize('25mB')).toBe(25 * 1024 * 1024);
    });

    it('should handle decimal values', () => {
      expect(parseSize('1.5mb')).toBe(Math.floor(1.5 * 1024 * 1024));
    });

    it('should handle leading/trailing whitespace', () => {
      expect(parseSize('  25mb  ')).toBe(25 * 1024 * 1024);
    });

    it('should parse 10mb', () => {
      expect(parseSize('10mb')).toBe(10 * 1024 * 1024);
    });

    it('should parse 2gb', () => {
      expect(parseSize('2gb')).toBe(2 * 1024 * 1024 * 1024);
    });

    it('should parse 500kb', () => {
      expect(parseSize('500kb')).toBe(500 * 1024);
    });

    it('should throw for empty string', () => {
      expect(() => parseSize('')).toThrow('Invalid size');
    });

    it('should throw for invalid unit', () => {
      expect(() => parseSize('25xx')).toThrow('Invalid size format');
    });

    it('should throw for missing number', () => {
      expect(() => parseSize('mb')).toThrow('Invalid size format');
    });

    it('should throw for just a number without unit', () => {
      expect(() => parseSize('25')).toThrow('Invalid size format');
    });
  });
});

describe('estimateWavSize', () => {
  it('should estimate size for 1 second of 16kHz mono 16-bit WAV', () => {
    // 44 header + (1 * 16000 * 1 * 2) = 44 + 32000 = 32044
    expect(estimateWavSize(1000, 16000, 1, 16)).toBe(32044);
  });

  it('should estimate size for 1 minute of 16kHz mono 16-bit WAV', () => {
    // 44 + (60 * 16000 * 1 * 2) = 44 + 1920000 = 1920044
    expect(estimateWavSize(60000, 16000, 1, 16)).toBe(1920044);
  });

  it('should estimate size for stereo audio', () => {
    // 44 + (1 * 16000 * 2 * 2) = 44 + 64000 = 64044
    expect(estimateWavSize(1000, 16000, 2, 16)).toBe(64044);
  });

  it('should estimate size for 44.1kHz audio', () => {
    // 44 + (1 * 44100 * 1 * 2) = 44 + 88200 = 88244
    expect(estimateWavSize(1000, 44100, 1, 16)).toBe(88244);
  });

  it('should estimate size for 8-bit audio', () => {
    // 44 + (1 * 16000 * 1 * 1) = 44 + 16000 = 16044
    expect(estimateWavSize(1000, 16000, 1, 8)).toBe(16044);
  });

  it('should return header only for zero duration', () => {
    expect(estimateWavSize(0, 16000, 1, 16)).toBe(44);
  });

  it('should handle fractional millisecond durations', () => {
    const size = estimateWavSize(500, 16000, 1, 16);
    // 44 + ceil(0.5 * 16000 * 1 * 2) = 44 + 16000 = 16044
    expect(size).toBe(16044);
  });
});
