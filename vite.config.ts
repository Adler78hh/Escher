import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages or any sub-folder.
// Older iPads run Safari 14/15, so the code is translated down for them.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: ['es2020', 'safari14', 'chrome87', 'firefox78', 'edge88'],
    cssTarget: ['safari14', 'chrome87', 'firefox78', 'edge88'],
  },
});
