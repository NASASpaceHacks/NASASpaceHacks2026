import { existsSync, statSync, createReadStream } from 'node:fs';
import { resolve, normalize, extname } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const SITEPACKS = resolve(import.meta.dirname, '../../SitePacks');
const MIME: Record<string, string> = {
  '.json': 'application/json', '.bin': 'application/octet-stream', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.tif': 'image/tiff',
};

/**
 * Dev only: serve /sitepacks/* straight from ../../SitePacks when the file exists, so `?mock=1&pack=gale-v1`
 * works without the hab server. Anything else falls through to the proxy (hab server, :8787).
 */
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

// Dev: proxy API + link + site packs to the hab server (Backend, :8787; override with MW_HAB=http://host:port).
const HAB = process.env.MW_HAB ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react(), tailwindcss(), localSitePacks()],
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
