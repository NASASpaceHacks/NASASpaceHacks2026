import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev: proxy API + link + site packs to the hab server (Backend, :8787).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/sitepacks': 'http://localhost:8787',
      '/link': { target: 'ws://localhost:8787', ws: true },
    },
  },
  worker: { format: 'es' },
});
