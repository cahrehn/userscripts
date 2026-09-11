// Helpers for driving a real Draftmancer solo bot draft with the userscript
// injected.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { get17LandsData, getScryfallCards } from './live-data.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const USERSCRIPT = join(HERE, '..', '..', 'mtg-draft-gih-wr-overlay.js');

/** Draftmancer renders the active drafter's position here. */
export const PICK_COUNTER = '#booster-controls';
export const OVERLAY = '.gih-wr-overlay';
export const BOOSTER_CARD = '.card.booster-card';

/**
 * Serve real (but locally cached) API data to the page.
 *
 * 17Lands must be routed: it sends no CORS headers, so the page's own fetch is
 * blocked. Scryfall does send them, but is routed too so a test run makes no
 * third-party requests beyond the one cached fetch per day.
 */
export async function routeApis(page, { expansion }) {
    const cardData = await get17LandsData(expansion);

    await page.route('**://www.17lands.com/api/card_data**', async (route) => {
        const colors = new URL(route.request().url()).searchParams.get('colors');
        // Colour-filtered requests get the real filtered dataset.
        const body = colors ? await get17LandsData(expansion, colors) : cardData;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify(body)
        });
    });

    await page.route('**://api.scryfall.com/cards/collection', async (route) => {
        const ids = (JSON.parse(route.request().postData() || '{}').identifiers || [])
            .map(i => i.id)
            .filter(Boolean);
        const body = ids.length ? await getScryfallCards(ids) : { data: [] };
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify(body)
        });
    });

    return cardData;
}

/** Inject the userscript exactly as a manager would, before the page scripts run. */
export async function injectUserscript(page) {
    await page.addScriptTag({ content: readFileSync(USERSCRIPT, 'utf8') });
}

/**
 * Start a solo bot draft of the given set and wait for the first pack.
 * `settle` is deliberately generous - this drives the real site, and the point
 * is to be gentle with it rather than fast.
 */
export async function startBotDraft(page, { bots = 7, settle = 2500 } = {}) {
    await page.locator('#bots').fill(String(bots));
    await page.waitForTimeout(settle);

    await page.getByRole('button', { name: 'Start', exact: true }).click();

    await expect(page.locator(PICK_COUNTER)).toBeVisible({ timeout: 30000 });
    await expect(page.locator(BOOSTER_CARD).first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(settle);
}

/**
 * Read the position the script keys off: the pack index and the booster size.
 * The "Pick #" number is ignored - it is an internal value, not a pick index.
 */
export async function readPosition(page) {
    const text = await page.locator(PICK_COUNTER).textContent();
    const pack = text.match(/Pack\s*#(\d+)/i);
    const booster = text.match(/Your\s+Booster\s*\((\d+)\)/i);
    return pack && booster
        ? { pack: Number(pack[1]), boosterSize: Number(booster[1]) }
        : null;
}

/**
 * Pick the first card in the booster and wait for the next pack.
 *
 * Double-click, not click: Draftmancer binds @click to selectCard (which only
 * highlights the card) and @dblclick to doubleClickCard, which actually submits
 * the pick. A single click leaves the draft sitting on the same pack.
 */
export async function makePick(page, { settle = 3000 } = {}) {
    const before = await readPosition(page);
    await page.locator(BOOSTER_CARD).first().dblclick();

    await expect
        .poll(async () => {
            const now = await readPosition(page);
            return now && (now.pack !== before.pack || now.boosterSize !== before.boosterSize);
        }, { timeout: 30000, intervals: [500, 1000, 2000] })
        .toBe(true);

    await page.waitForTimeout(settle);
}

/**
 * Toggle the overlay through the on-screen control.
 *
 * dispatchEvent rather than click(): the control cluster is draggable, and its
 * pointerdown handler captures the pointer, which swallows Playwright's
 * synthetic click. Real mouse and touch input is unaffected - this is a quirk of
 * driving the widget programmatically, not a bug in it.
 */
export async function toggleOverlay(page, { settle = 2500 } = {}) {
    await page.locator('.gih-wr-controls button[aria-label="Toggle win rate overlay"]')
        .dispatchEvent('click');
    await page.waitForTimeout(settle);
}

/** Click a control inside the cluster or a dialog, avoiding the drag handler. */
export async function clickControl(page, selector, { settle = 800 } = {}) {
    await page.locator(selector).dispatchEvent('click');
    await page.waitForTimeout(settle);
}
