import { defineConfig } from 'vite';

// MIXMASTER LA is a fully client-side app. Vite is only used for bundling the
// module graph (and the FLAC/MP3 encoder libraries) into static assets.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4000,
  },
  server: {
    host: true,
    port: 5173,
  },
});
