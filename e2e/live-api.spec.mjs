// Contract tests for the two APIs the userscript depends on.
//
// These make real network calls, so they are tagged and scheduled separately:
// the 17Lands API is not officially public, so it is touched as little as
// possible - weekly, not per-PR. They need no browser and no draft; they assert
// that the responses still have the shape the script parses.

import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { get17LandsData, getScryfallCards } from './fixtures/live-data.mjs';
import { offline17LandsData, OFFLINE_EXPANSION } from './fixtures/offline-data.mjs';

const SNAPSHOT_NAMES = JSON.parse(
    readFileSync(new URL('./fixtures/data/scryfall-names.json', import.meta.url), 'utf8'));

const EXPANSION = OFFLINE_EXPANSION;

test.describe('17Lands API contract @live-17lands', () => {
    // One request serves every assertion below, so the suite costs a single
    // call against an API that is not officially public.
    let payload;

    test.beforeAll(async () => {
        payload = await get17LandsData(EXPANSION);
    });

    test('returns card rows with the fields the overlay reads', async () => {
        expect(Array.isArray(payload.data)).toBe(true);
        expect(payload.data.length).toBeGreaterThan(0);

        const withRate = payload.data.filter(
            c => c.ever_drawn_win_rate != null || c.win_rate != null);

        // The overlay is useless without win rates on most of the set
        expect(withRate.length).toBeGreaterThan(payload.data.length / 2);

        const sample = withRate[0];
        expect(typeof sample.name).toBe('string');
        expect(sample.name.length).toBeGreaterThan(0);

        const rate = sample.ever_drawn_win_rate ?? sample.win_rate;
        expect(typeof rate).toBe('number');
        // A win rate is a fraction, not a percentage - the overlay multiplies by 100
        expect(rate).toBeGreaterThan(0);
        expect(rate).toBeLessThan(1);
    });

    test('still honours the colors filter, in WUBRG order only', async () => {
        const filtered = await get17LandsData(EXPANSION, 'WU');
        expect(filtered.data.length).toBeGreaterThan(0);

        const named = (payload.data.find(c => c.game_count > 0) || {}).name;
        const overall = payload.data.find(c => c.name === named);
        const inColours = filtered.data.find(c => c.name === named);

        // Filtering narrows the sample, which is the whole point of the feature
        if (overall?.game_count && inColours?.game_count) {
            expect(inColours.game_count).toBeLessThan(overall.game_count);
        }
    });

    test('the committed snapshot still matches the live shape', async () => {
        const snapshot = offline17LandsData(EXPANSION);
        const liveKeys = new Set(Object.keys(payload.data[0]));

        // Every field the snapshot carries must still exist upstream, or the
        // offline tests are asserting against a response that no longer exists.
        for (const key of Object.keys(snapshot.data[0])) {
            expect(liveKeys).toContain(key);
        }
    });
});

test.describe('Scryfall API contract @live-scryfall', () => {
    test('resolves ids to names via the collection endpoint', async () => {
        // Ids come from the committed snapshot so the request stays small and
        // stable rather than depending on whatever a draft happens to open.
        const ids = Object.keys(SNAPSHOT_NAMES).slice(0, 3);
        const live = await getScryfallCards(ids);

        expect(Array.isArray(live.data)).toBe(true);
        expect(live.data.length).toBe(ids.length);

        for (const card of live.data) {
            expect(typeof card.id).toBe('string');
            expect(typeof card.name).toBe('string');
        }
    });

    test('names in the committed snapshot still match upstream', async () => {
        const ids = Object.keys(SNAPSHOT_NAMES).slice(0, 5);
        const live = await getScryfallCards(ids);

        for (const card of live.data) {
            expect(card.name).toBe(SNAPSHOT_NAMES[card.id].name);
        }
    });
});
