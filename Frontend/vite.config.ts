import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Multi-page: launcher, Admin (habitat mission control) and User (astronaut HUD).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      input: {
        index: new URL('./index.html', import.meta.url).pathname,
        admin: new URL('./AdminView/index.html', import.meta.url).pathname,
        hud: new URL('./UserView/index.html', import.meta.url).pathname,
      },
    },
  },
});
