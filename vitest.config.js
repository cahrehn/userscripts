import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // The userscript logs to console during normal operation. Silence it so
        // test output shows only real failures.
        silent: true,
        include: ['test/**/*.test.js'],
        coverage: {
            include: ['mtg-draft-gih-wr-overlay.js'],
            reporter: ['text', 'lcov']
        }
    }
});
