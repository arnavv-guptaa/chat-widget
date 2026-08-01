import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // `server-only` throws when imported outside a React Server Component
      // build; alias it to an empty module so server modules (net-guard, the
      // handler, the store clients) are unit-testable under plain Node.
      'server-only': fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    // Default to node (most tests are server/pure-logic). Component tests opt
    // into a DOM with a `@vitest-environment jsdom` docblock — cheaper than
    // paying for jsdom setup on every server test.
    environment: 'node',
    // `.tsx` was missing here, so component tests silently never ran:
    // chart-render.test.tsx had been collected zero times since it was written.
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
});
