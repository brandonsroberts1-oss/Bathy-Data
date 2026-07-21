import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Vite dev server serves the React frontend on :5173 and proxies all
// /api requests to the Express backend on :8787, so the browser only ever
// talks to one origin during development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
