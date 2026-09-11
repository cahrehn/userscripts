import { test, expect } from '@playwright/test';
import {
    routeApis, injectUserscript, startBotDraft, makePick, readPosition, clickControl
} from './fixtures/draft.mjs';

const EXPANSION = 'HOB';

/** Read the colour filter the script currently has applied. */
async function readFilter(page) {
    return page.evaluate(() => {
        const button = document.querySelector('.gih-wr-controls')
            ?.querySelector('button[aria-label*="colour" i], button[aria-label*="color" i]');
        return button ? button.textContent : null;
    });
}

const COLOUR_NAMES = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };

/** Set a colour filter through the picker, as a user would. */
async function setFilter(page, colours) {
    await clickControl(page, '.gih-wr-controls button[aria-label="More options"]');
    await clickControl(page, 'button[aria-label="Filter win rates by deck colours"]');

    for (const colour of colours) {
        await clickControl(
            page, `.gih-wr-dialog button[aria-label="${COLOUR_NAMES[colour]}"]`, { settle: 300 });
    }

    await clickControl(
        page, '.gih-wr-dialog button[aria-label="Apply colour filter"]', { settle: 2500 });
}

test.describe('colour filter lifecycle', () => {
    test.beforeEach(async ({ page }) => {
        await routeApis(page, { expansion: EXPANSION });
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2500);
        await injectUserscript(page);
    });

    test('applies a colour filter and keeps it through the draft', async ({ page }) => {
        await startBotDraft(page);
        await setFilter(page, ['W', 'U']);

        await expect.poll(() => readFilter(page), { timeout: 30_000 })
            .toContain('WU');

        // The filter must survive ordinary picking
        await makePick(page);
        await page.waitForTimeout(1500);

        expect(await readFilter(page)).toContain('WU');
    });

    // The regression this whole mechanism exists for. A real second draft needs
    // a fresh session, so the new draft is simulated by feeding the script the
    // counter jump it would see - using the real values observed live.
    test('clears the filter when the pick counter restarts', async ({ page }) => {
        await startBotDraft(page);
        await setFilter(page, ['W', 'U']);
        await expect.poll(() => readFilter(page), { timeout: 30_000 }).toContain('WU');

        const start = await readPosition(page);
        expect(start.pack).toBe(1);

        await makePick(page);
        const afterPick = await readPosition(page);
        expect(afterPick.boosterSize).toBe(start.boosterSize - 1);

        // Rewrite the heading to a full booster on pack 1, exactly what
        // Draftmancer shows when a new draft begins, and let the observer see it.
        await page.evaluate((full) => {
            const el = document.querySelector('#booster-controls');
            const heading = el.querySelector('h2') || el;
            heading.textContent = `Your Booster (${full})`;
        }, start.boosterSize);

        await expect.poll(() => readFilter(page), { timeout: 30_000 })
            .toContain('Any');
    });
});
