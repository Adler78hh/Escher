import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages or any sub-folder.
export default defineConfig({
  base: './',
  plugins: [react()],
});
