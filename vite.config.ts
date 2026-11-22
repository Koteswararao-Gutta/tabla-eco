import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: { alias: { '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) } },
  server: { port: 5173 },
  // The list of every built file; the service worker reads it to keep all screens' code for offline start-up.
  // Two pages: index.html (manager app, TVs, kitchen) and front/index.html (the front app's own page, so a phone
  // saves it to the Home Screen as the Front app; see the note in front/index.html).
  build: {
    manifest: 'asset-manifest.json',
    rollupOptions: { input: { index: fileURLToPath(new URL('./index.html', import.meta.url)), front: fileURLToPath(new URL('./front/index.html', import.meta.url)) } },
  },
  test: { include: ['src/**/*.test.ts'] },
} as never);
