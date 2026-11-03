import { defineConfig } from 'vitest/config';

// Served from https://dovpulselab.github.io/PulseLabSim/ (v2 at the root, v1 at /v1/).
// `npm run build` also copies the unchanged v1 site from legacy-v1/ into dist/v1/.
export default defineConfig({
  base: '/PulseLabSim/',
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
});
