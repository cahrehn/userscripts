import { test, expect } from '@playwright/test';
import {
    routeApis, injectUserscript, startBotDraft, makePick,
    readPosition, toggleOverlay, OVERLAY, BOOSTER_CARD
} from './fixtures/draft.mjs';

// Draftmancer's default set. The 17Lands fixture is fetched for whatever this
// is, so it follows the site rather than pinning a set that will age out.
const EXPANSION = 'HOB';

test.describe('GIH WR overlay in a real bot draft', () => {
    test.beforeEach(async ({ page }) => {
        await routeApis(page, { expansion: EXPANSION });
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        // Let the lobby settle before touching anything.
        await page.waitForTimeout(2500);
        await injectUserscript(page);
    });

    test('renders a win-rate badge on the cards in the pack', async ({ page }) => {
        await startBotDraft(page);
        await toggleOverlay(page);

        const cards = await page.locator(BOOSTER_CARD).count();
        expect(cards).toBeGreaterThan(0);

        // Basic lands and the odd missing card mean this is not always 1:1, so
        // assert the overlay is broadly applied rather than demanding every card.
        const overlays = page.locator(OVERLAY);
        await expect.poll(() => overlays.count(), { timeout: 30_000 })
            .toBeGreaterThan(cards / 2);

        // A badge reads like "GIH: 56.7%" or "⚠️ WR: 51.2%"
        await expect(overlays.first()).toHaveText(/(GIH|WR):\s*\d+\.\d%/);
    });

    test('keeps badges on the next pack and toggles off on demand', async ({ page }) => {
        await startBotDraft(page);
        await toggleOverlay(page);

        const before = await page.locator(OVERLAY).count();
        expect(before).toBeGreaterThan(0);

        await makePick(page);

        // The script has an auto-off that triggers when card elements are
        // *removed* from the DOM. In a bot draft Draftmancer reuses the same
        // card elements for the next pack rather than removing them, so that
        // path does not fire and the badges stay up - which is the more useful
        // behaviour anyway. Asserted so a change in either is noticed.
        await expect.poll(() => page.locator(OVERLAY).count(), { timeout: 30_000 })
            .toBeGreaterThan(0);

        // Toggling off must still clear them
        await toggleOverlay(page);
        await expect.poll(() => page.locator(OVERLAY).count(), { timeout: 30_000 })
            .toBe(0);
    });

    // This is the test that would have caught the shipped bug. The pick counter
    // is not a per-pack index: it counts down from a fixed maximum, so the old
    // `pick === 1` condition could never be true in a real draft.
    test('counts the pick number down rather than up from one', async ({ page }) => {
        await startBotDraft(page);

        const first = await readPosition(page);
        expect(first.pack).toBe(1);
        // Whatever the maximum is, it is emphatically not 1
        expect(first.pick).toBeGreaterThan(1);

        await makePick(page);
        const second = await readPosition(page);

        expect(second.pack).toBe(1);
        expect(second.pick).toBeLessThan(first.pick);
    });
});
