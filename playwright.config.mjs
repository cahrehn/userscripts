import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: 'e2e',
    testMatch: '**/*.spec.mjs',

    // These drive the real draftmancer.com. One worker, no parallelism: several
    // headless browsers starting bot drafts at once is exactly the kind of load
    // a hobby site should not receive from a test suite.
    workers: 1,
    fullyParallel: false,

    // A bot draft involves real server round trips, so give each test room.
    timeout: 180_000,
    expect: { timeout: 30_000 },

    // Never retry locally - a retry is another full draft against the live site.
    // One retry in CI absorbs a genuine network blip without hammering.
    retries: process.env.CI ? 1 : 0,

    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

    use: {
        baseURL: 'https://draftmancer.com',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        // Identify the traffic honestly rather than posing as an ordinary user.
        userAgent: 'mtg-draft-gih-wr-overlay-e2e (Playwright; +https://github.com/cahrehn/userscripts)',
        actionTimeout: 30_000,
        navigationTimeout: 60_000
    },

    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
    ]
});
