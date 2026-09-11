import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { setBoosterControlsText, clearDom, packPickText } from './helpers/fake-dom.js';

const require = createRequire(import.meta.url);
const script = require('../mtg-draft-gih-wr-overlay.js');
const {
    readDraftPosition,
    checkForNewDraft,
    __setColorFilter,
    __getColorFilter,
    __resetDraftState
} = script;

const PACK_SIZE = 14;

/** Advance the fake draft to a position and let the script observe it. */
function observe(pack, boosterSize) {
    setBoosterControlsText(packPickText(pack, boosterSize));
    checkForNewDraft();
}

/** Observe a state where #booster-controls is absent or unreadable. */
function observeAbsent() {
    setBoosterControlsText(null);
    checkForNewDraft();
}

/** Play a whole pack, from a full booster down to the last card. */
function playPack(pack) {
    for (let size = PACK_SIZE; size >= 1; size--) observe(pack, size);
}

describe('readDraftPosition', () => {
    afterEach(clearDom);

    test('parses the counter as Draftmancer actually renders it', () => {
        // Heading, pack, and the trailing prompt all run together
        setBoosterControlsText('Your Booster (14)Pack #1, Pick #172Pick a card');
        expect(readDraftPosition()).toEqual({ pack: 1, boosterSize: 14 });
    });

    test('parses a later position with no trailing prompt', () => {
        setBoosterControlsText('Your Booster (7)Pack #2, Pick #835');
        expect(readDraftPosition()).toEqual({ pack: 2, boosterSize: 7 });
    });

    test('ignores the pick number entirely', () => {
        // The pick number climbs by ~95 a pick and means nothing usable, so two
        // positions differing only in it must read identically.
        setBoosterControlsText('Your Booster (14)Pack #1, Pick #172');
        const first = readDraftPosition();
        setBoosterControlsText('Your Booster (14)Pack #1, Pick #99999');
        expect(readDraftPosition()).toEqual(first);
    });

    test('returns null when the element is absent', () => {
        setBoosterControlsText(null);
        expect(readDraftPosition()).toBeNull();
    });

    test('returns null for the spectator view, which has no booster heading', () => {
        setBoosterControlsText('Players are drafting...Pack #2');
        expect(readDraftPosition()).toBeNull();
    });
});

describe('checkForNewDraft', () => {
    beforeEach(() => {
        __resetDraftState(null);
        __setColorFilter(null);
    });
    afterEach(clearDom);

    test('keeps the filter for a whole pack', () => {
        observe(1, PACK_SIZE);
        __setColorFilter('WU');

        playPack(1);

        expect(__getColorFilter()).toBe('WU');
    });

    // The booster refills at a pack boundary, which looks like a restart unless
    // the pack index advancing is taken into account.
    test('keeps the filter across a pack rollover', () => {
        observe(1, PACK_SIZE);
        __setColorFilter('WU');

        playPack(1);
        playPack(2);
        playPack(3);

        expect(__getColorFilter()).toBe('WU');
    });

    test('clears the filter when a new draft returns to pack 1', () => {
        observe(1, PACK_SIZE);
        __setColorFilter('WU');
        playPack(1);
        playPack(2);

        // A new draft starts over at pack 1
        observe(1, PACK_SIZE);

        expect(__getColorFilter()).toBeNull();
    });

    test('clears when a draft is restarted partway through pack 1', () => {
        observe(1, PACK_SIZE);
        __setColorFilter('WU');
        observe(1, 13);
        observe(1, 12);

        // Stopped and restarted: same pack, but the booster is full again
        observe(1, PACK_SIZE);

        expect(__getColorFilter()).toBeNull();
    });

    test('does not clear on repeated renders of the same position', () => {
        observe(1, PACK_SIZE);
        __setColorFilter('BR');

        for (let i = 0; i < 5; i++) observe(1, PACK_SIZE);

        expect(__getColorFilter()).toBe('BR');
    });

    // Draftmancer restores the session across a reload, so a resumed draft must
    // not look like a new one. init() seeds the baseline for this reason.
    test('keeps the filter when the page is reloaded mid-draft', () => {
        __resetDraftState({ pack: 2, boosterSize: 9 });
        __setColorFilter('WU');

        observe(2, 9);
        observe(2, 8);

        expect(__getColorFilter()).toBe('WU');
    });

    test('does not clear on the very first observation', () => {
        __resetDraftState(null);
        __setColorFilter('WU');

        observe(1, PACK_SIZE);

        expect(__getColorFilter()).toBe('WU');
    });

    test('is a no-op when no filter is set', () => {
        observe(2, 5);
        __setColorFilter(null);

        observe(1, PACK_SIZE);

        expect(__getColorFilter()).toBeNull();
    });

    test('ignores states where the counter is unreadable', () => {
        observe(2, 5);
        __setColorFilter('WU');

        observeAbsent();
        observeAbsent();

        // The last real position is retained, so the next draft is still caught
        expect(__getColorFilter()).toBe('WU');
        observe(1, PACK_SIZE);
        expect(__getColorFilter()).toBeNull();
    });
});
