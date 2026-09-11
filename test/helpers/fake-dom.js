// Minimal stand-in for the one DOM call the script makes at test time:
// document.querySelector('#booster-controls').textContent
//
// Deliberately not jsdom - readDraftPosition() only reads textContent off a
// single element, so a real DOM implementation would be a large dependency
// bought for nothing.

/**
 * Install a fake `document` whose #booster-controls element has the given text.
 * Pass null to simulate the element being absent (lobby, deck building, or the
 * 17Lands site), which is what makes readDraftPosition() return null.
 */
export function setBoosterControlsText(text) {
    globalThis.document = {
        querySelector(selector) {
            if (selector !== '#booster-controls') return null;
            if (text === null || text === undefined) return null;
            return { textContent: text };
        }
    };
}

/** Remove the fake document entirely. */
export function clearDom() {
    delete globalThis.document;
}

/** Build the counter text Draftmancer renders for a given position. */
export function packPickText(pack, pick) {
    return `Your Booster (15)Pack #${pack}, Pick #${pick}`;
}
