import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.test.tsx'],
    environment: 'node',
    /**
     * 30s, against vitest's default of 5s, and this is a FLAKE fix rather than a
     * slow-test excuse (2026-09-12).
     *
     * Dozens of these tests play real games - `commons.test.ts` runs whole seeds
     * move for move at two, three and four seats - and the slowest sit just under
     * five seconds on an idle machine. This machine swings about 1.6x by state,
     * so the moment anything else is running (a watchlist arm, another vitest
     * project, a Dropbox index) those tests cross the line and fail on TIME while
     * asserting nothing. Measured on 12/09/2026: two full-suite runs, back to
     * back, each failing one test and a DIFFERENT one each time.
     *
     * A gate that fails at random is a gate nobody reads. 30s still catches a
     * genuine hang; it just stops the clock being the thing under test.
     */
    testTimeout: 30_000,
  },
});
