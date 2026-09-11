import { defineConfig, devices } from '@playwright/test';

// Three groups of tests with very different costs:
//
//   draftmancer     drives a real bot draft, but serves committed API
//                   snapshots - no third-party API traffic, so it runs on
//                   every PR and is what catches DOM drift.
//   live-scryfall   a handful of real Scryfall calls. Their API is public and
//                   documented, so daily is fine.
//   live-17lands    real calls to an API that is NOT officially public.
//                   Weekly, one request per run, and nothing else.
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
        {
            // The browser tests. Grep excludes the tagged live-API specs.
            name: 'draftmancer',
            testIgnore: '**/live-api.spec.mjs',
            use: { ...devices['Desktop Chrome'] }
        },
        {
            name: 'live-scryfall',
            testMatch: '**/live-api.spec.mjs',
            grep: /@live-scryfall/
        },
        {
            name: 'live-17lands',
            testMatch: '**/live-api.spec.mjs',
            grep: /@live-17lands/
        }
    ]
});
