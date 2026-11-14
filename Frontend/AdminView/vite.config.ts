import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev: proxy API + link + site packs to the hab server (Backend, :8787; override with HAB_URL).
const hab = process.env.HAB_URL ?? 'http://localhost:8787';
const proxy = {
  '/api': hab,
  '/sitepacks': hab,
  '/link': { target: hab.replace(/^http/, 'ws'), ws: true },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // One OpenLayers/proj4 instance across @mw/shared and the app (shared projection registry).
    dedupe: ['ol', 'proj4'],
  },
  server: { proxy },
  preview: { proxy },
  worker: { format: 'es' },
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
