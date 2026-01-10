import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['react', 'react-dom'],
  treeshake: true,
  splitting: false,
  minify: false,
  esbuildOptions(options) {
    options.loader = {
      ...options.loader,
      '.png': 'dataurl',
    };
  },
  onSuccess: async () => {
    // Copy CSS file to dist
    const fs = await import('fs');
    const path = await import('path');
    const src = path.join(process.cwd(), 'src/styles.css');
    const dest = path.join(process.cwd(), 'dist/styles.css');
    fs.copyFileSync(src, dest);
    console.log('Copied styles.css to dist/');
  },
});
