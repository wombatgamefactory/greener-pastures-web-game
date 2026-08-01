import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// GitHub Pages serves a project site from /<repo>/, so the built asset URLs need
// that prefix. Local dev and `vite preview` serve from the root.
const REPO_BASE = '/greener-pastures-web-game/';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? REPO_BASE : '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
}));
