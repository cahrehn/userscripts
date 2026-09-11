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

    test('clears every badge when a pick is made', async ({ page }) => {
        await startBotDraft(page);
        await toggleOverlay(page);
        expect(await page.locator(OVERLAY).count()).toBeGreaterThan(0);

        await makePick(page);

        // Picking auto-disables the overlay. Every badge must go: a repaint is
        // debounced by 200ms, and if it is not cancelled it lands after the
        // hide and paints badges back onto whichever cards carried over into
        // the next pack - which is exactly what used to happen.
        await expect.poll(() => page.locator(OVERLAY).count(), { timeout: 30_000 })
            .toBe(0);

        // Still usable afterwards
        await toggleOverlay(page);
        await expect.poll(() => page.locator(OVERLAY).count(), { timeout: 30_000 })
            .toBeGreaterThan(0);
    });

    test('leaves no badge behind across several picks', async ({ page }) => {
        await startBotDraft(page);

        for (let i = 0; i < 3; i++) {
            await toggleOverlay(page);
            expect(await page.locator(OVERLAY).count()).toBeGreaterThan(0);
            await makePick(page);
            await expect.poll(() => page.locator(OVERLAY).count(), { timeout: 30_000 })
                .toBe(0);
        }
    });

    // Documents the numbers the reset logic depends on. The pick number is
    // deliberately not asserted: it is an internal value that climbs by ~95 a
    // pick, and reading it as a pick index is what broke new-draft detection.
    test('counts the booster down and holds the pack index', async ({ page }) => {
        await startBotDraft(page);

        const first = await readPosition(page);
        expect(first.pack).toBe(1);
        expect(first.boosterSize).toBeGreaterThan(1);

        await makePick(page);
        const second = await readPosition(page);

        expect(second.pack).toBe(1);
        expect(second.boosterSize).toBe(first.boosterSize - 1);
    });
});
