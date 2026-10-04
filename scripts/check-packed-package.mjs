// Validate the actual archive, including the gateway amount sent by its component.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const dir = mkdtempSync(resolve('node_modules/.reevit-checkout-package-'));
try {
  const [archive] = JSON.parse(execFileSync('npm', ['pack', '--cache', join(dir, 'npm-cache'), '--ignore-scripts', '--json', '--pack-destination', dir], { encoding: 'utf8' }));
  execFileSync('tar', ['-xzf', join(dir, archive.filename), '-C', dir]);
  symlinkSync(resolve('node_modules'), join(dir, 'node_modules'), 'dir');
  const pkg = JSON.parse(readFileSync(join(dir, 'package/package.json'), 'utf8'));
  assert.equal(pkg.version, manifest.version);
  for (const file of ['dist/index.js', 'dist/index.mjs', 'dist/index.d.ts']) {
    assert.ok(existsSync(join(dir, 'package', file)), `missing ${file}`);
  }
  const stylesheet = pkg.exports['./styles.css'];
  assert.ok(existsSync(join(dir, 'package', stylesheet)), 'missing exported stylesheet');
  execFileSync('npm', ['exec', '--', 'vitest', 'run', "src/bridges/FlutterwaveBridge.test.tsx"], {
    stdio: 'inherit', env: { ...process.env, npm_config_cache: join(dir, 'npm-cache'), REEVIT_PACKED_ENTRY: join(dir, 'package/dist/index.mjs'), VITE_REEVIT_PACKED_ENTRY: join(dir, 'package/dist/index.mjs') },
  });
  console.log(`Packed ${pkg.name}@${pkg.version}: exports and gateway currency amounts verified.`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
