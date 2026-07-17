#!/usr/bin/env node
/**
 * Remove published root favicons before Vite build.
 * Otherwise Vite fingerprints the stale root copies into assets/
 * and HTML links the old (often dark-on-dark) icons instead of public/.
 */
import { unlinkSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const name of [
  'favicon.ico',
  'favicon.png',
  'favicon-16.png',
  'favicon-32.png',
  'favicon-48.png',
  'apple-touch-icon.png',
  'janko.ico',
]) {
  const p = resolve(root, name);
  if (existsSync(p)) unlinkSync(p);
}
