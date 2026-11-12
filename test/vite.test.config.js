import { defineConfig } from 'vite';
import path from 'path';
export default defineConfig({
  root: path.resolve(__dirname, '..'), base: './', logLevel: 'error',
  resolve: { alias: [{ find: /^maplibre-gl$/, replacement: path.resolve(__dirname, 'maplibre-stub.js') }, { find: /^maplibre-gl\/dist\/maplibre-gl\.css$/, replacement: path.resolve(__dirname, 'empty.css') }] },
  define: { 'import.meta.env.VITE_SUPABASE_URL': '""', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '""' },
  build: { outDir: '/tmp/blimp-test', emptyOutDir: true, minify: false, modulePreload: false }
});
