import { defineConfig } from 'vitest/config';

// v2 is served from https://<user>.github.io/PulseLabSim/
// Until stage 5 the v1 site keeps the root index.html, so the v2 entry page is v2.html.
export default defineConfig({
  base: '/PulseLabSim/',
  build: {
    outDir: 'dist',
    rollupOptions: { input: 'v2.html' }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
});
