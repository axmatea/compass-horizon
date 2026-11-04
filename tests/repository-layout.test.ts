import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const repository = readJson('package.json');
const product = readJson('compass/package.json');

describe('canonical repository layout', () => {
  it('forwards product commands to the existing product package', () => {
    for (const command of ['dev', 'build', 'start', 'test', 'typecheck']) {
      expect(product.scripts[command]).toBeTypeOf('string');
      expect(repository.scripts[`product:${command}`]).toBe(
        `npm --prefix compass run ${command}`,
      );
    }
    expect(repository.scripts['product:install']).toBe('npm --prefix compass ci');
  });

  it('preserves separate deployment entry points and dependency locks', () => {
    expect(repository.scripts.build).toBe('next build');
    expect(repository.scripts.start).toBe('next start');
    for (const path of [
      'package-lock.json', 'compass/package-lock.json',
      'compass/Dockerfile', 'compass/railway.json', 'compass/server.mjs',
    ]) {
      expect(existsSync(new URL(path, root)), path).toBe(true);
    }
    const excluded = readFileSync(new URL('.vercelignore', root), 'utf8').split(/\r?\n/);
    expect(excluded).toContain('compass');
    expect(existsSync(new URL('compass/.git', root))).toBe(false);
  });
});
