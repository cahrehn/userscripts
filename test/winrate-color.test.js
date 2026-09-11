import { describe, test, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getWinrateColor } = require('../mtg-draft-gih-wr-overlay.js');

const EXCELLENT = '#60a5fa';
const GOOD = '#93c5fd';
const ABOVE_AVERAGE = '#e0e7ff';
const AVERAGE = '#fbbf24';
const BELOW_AVERAGE = '#fb923c';

// The thresholds are inclusive lower bounds; each boundary is checked on both
// sides so a future ">" / ">=" slip is caught.
describe('getWinrateColor', () => {
    test('buckets win rates by band', () => {
        expect(getWinrateColor(0.62)).toBe(EXCELLENT);
        expect(getWinrateColor(0.565)).toBe(GOOD);
        expect(getWinrateColor(0.535)).toBe(ABOVE_AVERAGE);
        expect(getWinrateColor(0.51)).toBe(AVERAGE);
        expect(getWinrateColor(0.42)).toBe(BELOW_AVERAGE);
    });

    test.each([
        [0.58, EXCELLENT, GOOD],
        [0.55, GOOD, ABOVE_AVERAGE],
        [0.52, ABOVE_AVERAGE, AVERAGE],
        [0.50, AVERAGE, BELOW_AVERAGE]
    ])('%f is the inclusive lower bound of its band', (threshold, atOrAbove, below) => {
        expect(getWinrateColor(threshold)).toBe(atOrAbove);
        expect(getWinrateColor(threshold - 0.001)).toBe(below);
    });

    test('handles the extremes', () => {
        expect(getWinrateColor(1)).toBe(EXCELLENT);
        expect(getWinrateColor(0)).toBe(BELOW_AVERAGE);
    });
});
