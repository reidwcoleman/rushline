import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  server: { port: 5330, open: false, hmr: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
}));
