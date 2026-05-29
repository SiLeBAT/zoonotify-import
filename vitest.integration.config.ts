import { defineConfig } from 'vitest/config';

// Runs only the docker-compose integration suite. Invoked by
// `npm run test:integration`, which brings up the stack first.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/integration/**/*.integration.test.ts'],
    // A live Strapi import takes a while; give the suite room.
    testTimeout: 240_000,
    hookTimeout: 240_000,
  },
});
