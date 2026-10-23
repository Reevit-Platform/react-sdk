import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SDK_VERSION } from './version';

describe('SDK_VERSION', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
    expect(SDK_VERSION).toBe(pkg.version);
  });
});
