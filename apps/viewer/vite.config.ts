import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const COLLECTOR = process.env.ARA_COLLECTOR_URL ?? 'http://127.0.0.1:4747';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 4748,
    proxy: {
      '/events': COLLECTOR,
      '/state': COLLECTOR,
      '/world': COLLECTOR,
      '/session': COLLECTOR,
      '/history': COLLECTOR,
      '/fixture': COLLECTOR,
      '/health': COLLECTOR,
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4748,
    proxy: {
      '/events': COLLECTOR,
      '/state': COLLECTOR,
      '/world': COLLECTOR,
      '/session': COLLECTOR,
      '/history': COLLECTOR,
      '/fixture': COLLECTOR,
      '/health': COLLECTOR,
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
