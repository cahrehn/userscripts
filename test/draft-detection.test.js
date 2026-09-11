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

// Values observed in a real Draftmancer bot draft. The number after "Pick #"
// counts DOWN from a fixed maximum as the draft proceeds; it is not a per-pack
// index and never reaches 1.
const DRAFT_START_PICK = 173;
const LATER_PICKS = [170, 168, 165, 163, 160];

/** Advance the fake draft to a position and let the script observe it. */
function observe(pack, pick) {
    setBoosterControlsText(packPickText(pack, pick));
    checkForNewDraft();
}

/** Observe a state where #booster-controls is absent or unreadable. */
function observeAbsent() {
    setBoosterControlsText(null);
    checkForNewDraft();
}

describe('readDraftPosition', () => {
    afterEach(clearDom);

    test('parses the counter as Draftmancer actually renders it', () => {
        // The trailing prompt runs straight into the number, with no separator
        setBoosterControlsText('Your Booster (14)Pack #1, Pick #173Pick a card');
        expect(readDraftPosition()).toEqual({ pack: 1, pick: 173 });
    });

    test('parses a later pick with no trailing prompt', () => {
        setBoosterControlsText('Your Booster (14)Pack #1, Pick #170');
        expect(readDraftPosition()).toEqual({ pack: 1, pick: 170 });
    });

    test('tolerates the template whitespace around the interpolation', () => {
        setBoosterControlsText('Pack #2,\n\t\t\tPick #145');
        expect(readDraftPosition()).toEqual({ pack: 2, pick: 145 });
    });

    test('returns null when the element is absent', () => {
        setBoosterControlsText(null);
        expect(readDraftPosition()).toBeNull();
    });

    test('returns null for the spectator view, which has no pick number', () => {
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

    test('clears the filter when the pick counter jumps back up', () => {
        observe(1, DRAFT_START_PICK);
        __setColorFilter('WU');
        for (const pick of LATER_PICKS) observe(1, pick);

        // A new draft restarts the counter at its maximum
        observe(1, DRAFT_START_PICK);

        expect(__getColorFilter()).toBeNull();
    });

    test('keeps the filter as the counter descends through a draft', () => {
        observe(1, DRAFT_START_PICK);
        __setColorFilter('WU');

        for (const pick of LATER_PICKS) observe(1, pick);

        expect(__getColorFilter()).toBe('WU');
    });

    test('keeps the filter across a pack rollover', () => {
        observe(1, 140);
        __setColorFilter('WU');

        // The counter keeps descending into later packs
        observe(2, 130);
        observe(2, 128);
        observe(3, 90);

        expect(__getColorFilter()).toBe('WU');
    });

    test('does not clear on repeated renders of the same position', () => {
        observe(1, DRAFT_START_PICK);
        __setColorFilter('BR');

        for (let i = 0; i < 5; i++) observe(1, DRAFT_START_PICK);

        expect(__getColorFilter()).toBe('BR');
    });

    // Draftmancer restores the session across a reload, so the resumed draft
    // must not look like a new one. init() seeds the baseline for this reason.
    test('keeps the filter when the page is reloaded mid-draft', () => {
        __resetDraftState({ pack: 1, pick: 162 });
        __setColorFilter('WU');

        observe(1, 162);
        observe(1, 160);

        expect(__getColorFilter()).toBe('WU');
    });

    test('does not clear on the very first observation', () => {
        // No previous position to compare against - cannot be a jump
        __resetDraftState(null);
        __setColorFilter('WU');

        observe(1, DRAFT_START_PICK);

        expect(__getColorFilter()).toBe('WU');
    });

    test('clears when the pack number goes backwards', () => {
        observe(3, 90);
        __setColorFilter('WU');

        // A new draft that happens to start below the previous pick number is
        // still caught, because the pack index went back
        observe(1, 85);

        expect(__getColorFilter()).toBeNull();
    });

    test('is a no-op when no filter is set', () => {
        observe(1, 160);
        __setColorFilter(null);

        observe(1, DRAFT_START_PICK);

        expect(__getColorFilter()).toBeNull();
    });

    test('ignores states where the counter is unreadable', () => {
        observe(1, DRAFT_START_PICK);
        __setColorFilter('WU');
        observe(1, 160);

        observeAbsent();
        observeAbsent();

        // The last real position is retained, so the next draft is still caught
        expect(__getColorFilter()).toBe('WU');
        observe(1, DRAFT_START_PICK);
        expect(__getColorFilter()).toBeNull();
    });
});
