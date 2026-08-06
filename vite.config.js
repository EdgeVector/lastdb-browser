import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 7667,
    // In dev, Vite serves the UI and forwards data-plane calls to the bridge,
    // so the app talks to one origin in both dev and built modes.
    proxy: {
      '/db': {
        target: 'http://127.0.0.1:7666',
        changeOrigin: false,
        // The schema catalog read is a ~30s node call; the default proxy
        // timeout would abort it and look like a dead bridge.
        timeout: 200_000,
        proxyTimeout: 200_000,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
