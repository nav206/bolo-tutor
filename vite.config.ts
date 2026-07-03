import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.EDGEONE_DEV_URL || 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/chat': apiTarget,
      '/stop': apiTarget,
      '/history': apiTarget,
      '/conversations': apiTarget,
      '/clear-history': apiTarget,
      '/delete-conversation': apiTarget,
      '/session': apiTarget,
    },
  },
});