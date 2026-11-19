import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: { alias: { '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) } },
  server: { port: 5173 },
  // The list of every built file; the service worker reads it to keep all screens' code for offline start-up.
  build: { manifest: 'asset-manifest.json' },
  test: { include: ['src/**/*.test.ts'] },
} as never);
