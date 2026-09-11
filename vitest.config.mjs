import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // The userscript logs to console during normal operation. Silence it so
        // test output shows only real failures.
        silent: true,
        include: ['test/**/*.test.js'],
        coverage: {
            provider: 'v8',
            include: ['mtg-draft-gih-wr-overlay.js'],
            // json-summary feeds the CI job summary; lcov is the interchange
            // format, so an e2e run's coverage can later be merged with this one.
            // html is for reading locally.
            reporter: ['text', 'json-summary', 'lcov', 'html'],
            reportsDirectory: 'coverage'
            // Deliberately no thresholds. Roughly 500 of this file's ~1350 lines
            // build DOM nodes and style strings, which unit tests should not be
            // pushed into asserting on. Treat the number as a trend, not a gate.
        }
    }
});
