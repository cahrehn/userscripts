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

/** Advance the fake draft to a position and let the script observe it. */
function observe(pack, pick) {
    setBoosterControlsText(packPickText(pack, pick));
    checkForNewDraft();
}

/** Observe a state where #booster-controls is absent (lobby / deck building). */
function observeAbsent() {
    setBoosterControlsText(null);
    checkForNewDraft();
}

describe('readDraftPosition', () => {
    afterEach(clearDom);

    test('parses the counter Draftmancer renders', () => {
        setBoosterControlsText(packPickText(2, 7));
        expect(readDraftPosition()).toEqual({ pack: 2, pick: 7 });
    });

    test('tolerates the template whitespace around the interpolation', () => {
        setBoosterControlsText('Pack #1,\n\t\t\tPick #1');
        expect(readDraftPosition()).toEqual({ pack: 1, pick: 1 });
    });

    test('parses double-digit picks', () => {
        setBoosterControlsText(packPickText(3, 14));
        expect(readDraftPosition()).toEqual({ pack: 3, pick: 14 });
    });

    test('returns null when the element is absent', () => {
        setBoosterControlsText(null);
        expect(readDraftPosition()).toBeNull();
    });

    test('returns null for the spectator view, which has no pick number', () => {
        // Watchers see "Pack #2" with no ", Pick #N" - must not be read as a position
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

    test('clears the filter when a new draft reaches P1P1', () => {
        __resetDraftState({ pack: 3, pick: 14 });
        __setColorFilter('WU');

        observe(1, 1);

        expect(__getColorFilter()).toBeNull();
    });

    // The regression that shipped: loading the page in the lobby leaves no
    // previous position, so an earlier "was the previous position elsewhere"
    // guard suppressed the reset for the first draft after every page load.
    test('clears on the first draft after loading in the lobby', () => {
        __resetDraftState(null);   // page loaded with no draft in progress
        __setColorFilter('WU');    // filter restored from localStorage

        observeAbsent();           // still in the lobby
        observe(1, 1);             // draft fires

        expect(__getColorFilter()).toBeNull();
    });

    test('does not clear a filter set during P1P1 when the view re-renders', () => {
        observe(1, 1);             // arrive at the first pick
        __setColorFilter('BR');    // user picks colours on their first pick

        for (let i = 0; i < 5; i++) observe(1, 1);   // Vue re-renders repeatedly

        expect(__getColorFilter()).toBe('BR');
    });

    test('keeps the filter through a pack rollover', () => {
        observe(1, 1);
        __setColorFilter('WU');

        observe(1, 14);
        observe(2, 1);             // new pack, not a new draft
        observe(3, 1);

        expect(__getColorFilter()).toBe('WU');
    });

    test('keeps the filter across the rest of the draft', () => {
        observe(1, 1);
        __setColorFilter('WU');

        for (let pack = 1; pack <= 3; pack++) {
            for (let pick = 1; pick <= 14; pick++) {
                if (pack === 1 && pick === 1) continue;
                observe(pack, pick);
            }
        }

        expect(__getColorFilter()).toBe('WU');
    });

    test('clears across the deck-building gap between two drafts', () => {
        observe(1, 1);
        __setColorFilter('WU');
        observe(3, 13);
        observe(3, 14);

        observeAbsent();           // deck building - element is gone
        observeAbsent();

        observe(1, 1);             // next draft

        expect(__getColorFilter()).toBeNull();
    });

    test('keeps the filter when the page is reloaded mid-draft', () => {
        __resetDraftState({ pack: 2, pick: 5 });   // init() seeds from the live DOM
        __setColorFilter('WU');

        observe(2, 5);
        observe(2, 6);

        expect(__getColorFilter()).toBe('WU');
    });

    // Reloading while sitting on the first pick must not discard the filter you
    // just set - that P1P1 belongs to the draft the filter was chosen for.
    test('keeps the filter when the page is reloaded on P1P1', () => {
        __resetDraftState({ pack: 1, pick: 1 });
        __setColorFilter('WU');

        observe(1, 1);
        observe(1, 1);

        expect(__getColorFilter()).toBe('WU');
    });

    test('is a no-op when no filter is set', () => {
        __resetDraftState({ pack: 3, pick: 14 });
        __setColorFilter(null);

        observe(1, 1);

        expect(__getColorFilter()).toBeNull();
    });

    test('ignores states where the counter is unreadable', () => {
        __resetDraftState({ pack: 3, pick: 14 });
        __setColorFilter('WU');

        observeAbsent();

        // Position must be retained so the next real observation still sees
        // that we were deeper in a draft
        expect(__getColorFilter()).toBe('WU');
    });
});
