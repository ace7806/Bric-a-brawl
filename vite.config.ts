import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const root = import.meta.dirname;

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@sim': resolve(root, 'src/sim'),
      '@net': resolve(root, 'src/net'),
      '@host': resolve(root, 'src/host'),
      '@bots': resolve(root, 'src/bots'),
      '@client': resolve(root, 'src/client'),
      '@data': resolve(root, 'data'),
    },
  },
  build: {
    target: 'es2023',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        m1: resolve(root, 'm1.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('@dimforge/rapier2d-deterministic-compat')) return 'rapier';
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/trystero')) return 'trystero';
          if (id.includes('node_modules/msgpackr')) return 'msgpackr';
          return undefined;
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
});
