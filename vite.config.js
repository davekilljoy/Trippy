import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3737',
        configure: (proxy) => {
          proxy.on('error', (err) => {
            // ECONNRESET is expected when the browser cancels an in-flight
            // request (e.g. unmounted <img>, HMR, navigation). Don't spam the log.
            if (err.code !== 'ECONNRESET') console.error('[proxy]', err.message);
          });
        },
      },
    },
  },
});
