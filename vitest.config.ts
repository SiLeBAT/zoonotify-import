import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Integration tests need the docker-compose stack; they run via
    // `npm run test:integration` (vitest.integration.config.ts), never here.
    exclude: [...configDefaults.exclude, 'test/integration/**'],
  },
});
