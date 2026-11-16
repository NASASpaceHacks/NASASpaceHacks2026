import { existsSync, statSync, createReadStream } from 'node:fs';
import { resolve, normalize, extname } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

const SITEPACKS = resolve(import.meta.dirname, '../../SitePacks');
const MIME: Record<string, string> = {
  '.json': 'application/json', '.bin': 'application/octet-stream', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.tif': 'image/tiff',
};

/** Dev only: serve /sitepacks/* from ../../SitePacks when present (mock mode works without the hab server). */
function localSitePacks(): Plugin {
  return {
    name: 'mw-local-sitepacks',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/sitepacks/')) return next();
        const rel = decodeURIComponent(req.url.slice('/sitepacks/'.length).split('?')[0]);
        const file = normalize(resolve(SITEPACKS, rel));
        if (!file.startsWith(SITEPACKS) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('content-type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },
  };
}

// Hab server (Backend, :8787). The phone talks only to this dev server; it proxies API, link and site packs.
const HAB = process.env.MW_HAB ?? 'http://localhost:8787';
// iOS Safari only grants camera + compass on a secure origin, so serve HTTPS (self-signed) by default.
const HTTPS = process.env.MW_HTTPS !== '0';

export default defineConfig({
  plugins: [react(), localSitePacks(), ...(HTTPS ? [basicSsl()] : [])],
  resolve: { dedupe: ['react', 'react-dom', 'zustand'] },
  server: {
    proxy: {
      '/api': HAB,
      '/sitepacks': HAB,
      '/link': { target: HAB.replace(/^http/, 'ws'), ws: true },
    },
  },
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1500 },
});
