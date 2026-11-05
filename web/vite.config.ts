import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Relativní cesty, aby build fungoval i na GitHub Pages v podsložce.
  base: './',
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
});
