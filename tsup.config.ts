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
    // Ship dist/styles.css with the bundled fonts inlined as data URIs, so the
    // stylesheet works wherever it is loaded from (bundler, CDN, raw import).
    const fs = await import('fs');
    const path = await import('path');
    const src = path.join(process.cwd(), 'src/styles.css');
    const dest = path.join(process.cwd(), 'dist/styles.css');
    const css = fs.readFileSync(src, 'utf8').replace(
      /url\((['"]?)(\.\/assets\/fonts\/[^'")]+\.woff2)\1\)/g,
      (_match, _quote, rel: string) => {
        const font = fs.readFileSync(path.join(process.cwd(), 'src', rel));
        return `url(data:font/woff2;base64,${font.toString('base64')})`;
      },
    );
    if (/url\((['"]?)\.\//.test(css)) {
      throw new Error('dist/styles.css still has a relative url(); inline it in tsup.config.ts');
    }
    fs.writeFileSync(dest, css);
    console.log(`Wrote styles.css to dist/ (${(css.length / 1024).toFixed(0)} KB, fonts inlined)`);
  },
});
