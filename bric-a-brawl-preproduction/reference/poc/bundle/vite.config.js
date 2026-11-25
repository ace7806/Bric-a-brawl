import { defineConfig } from 'vite';
export default defineConfig({ build: { rollupOptions: { output: { manualChunks(id){ if(id.includes('rapier')) return 'rapier'; if(id.includes('node_modules/three')) return 'three'; if(id.includes('trystero')) return 'trystero'; if(id.includes('msgpackr')) return 'msgpackr'; if(id.includes('geckos')) return 'geckos-si'; } } }, reportCompressedSize:false } });
