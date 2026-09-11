import { describe, test, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeColors } = require('../mtg-draft-gih-wr-overlay.js');

// 17Lands returns HTTP 200 with an empty data array for a colors= value it does
// not recognise, which is indistinguishable from "this set has no cards". Every
// case below exists to keep a malformed value from ever reaching the API.
describe('normalizeColors', () => {
    test('passes through a pair already in WUBRG order', () => {
        expect(normalizeColors('WU')).toBe('WU');
        expect(normalizeColors('BR')).toBe('BR');
    });

    test('reorders into WUBRG - the bug that returns an empty dataset', () => {
        expect(normalizeColors('UW')).toBe('WU');
        expect(normalizeColors('RB')).toBe('BR');
        expect(normalizeColors('GW')).toBe('WG');
        expect(normalizeColors('GRUBW')).toBe('WUBRG');
    });

    test('uppercases lowercase input', () => {
        expect(normalizeColors('uw')).toBe('WU');
        expect(normalizeColors('wubrg')).toBe('WUBRG');
    });

    test('removes duplicates', () => {
        expect(normalizeColors('WW')).toBe('W');
        expect(normalizeColors('wubrgwubrg')).toBe('WUBRG');
    });

    test('drops characters that are not colours', () => {
        expect(normalizeColors('XY')).toBe('');
        expect(normalizeColors('W-U')).toBe('WU');
        expect(normalizeColors('  w u  ')).toBe('WU');
        expect(normalizeColors('W1U!')).toBe('WU');
    });

    test('returns empty string for empty or missing input', () => {
        expect(normalizeColors('')).toBe('');
        expect(normalizeColors(null)).toBe('');
        expect(normalizeColors(undefined)).toBe('');
    });

    test('is idempotent', () => {
        for (const input of ['UW', 'grub', 'WW', 'XY']) {
            const once = normalizeColors(input);
            expect(normalizeColors(once)).toBe(once);
        }
    });
});
