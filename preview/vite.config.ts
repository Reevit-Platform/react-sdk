import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  resolve: {
    alias: {
      '@': resolve(__dirname, '../src'),
    },
  },
  server: {
    port: 3333,
    open: true,
  },
});
