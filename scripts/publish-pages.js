#!/usr/bin/env node
// Publish the Vite production build to the repo root so GitHub Pages
// (which serves this branch from `/`) gets bundled CSS + JS — not the
// raw Vite source that browsers cannot execute.
import { cpSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const assetsSrc = resolve(dist, 'assets');
const assetsDst = resolve(root, 'assets');
const distIndex = resolve(dist, 'index.html');
const rootIndex = resolve(root, 'index.html');

if (!existsSync(distIndex) || !existsSync(assetsSrc)) {
  console.error('dist/ is missing — run `vite build` first');
  process.exit(1);
}

rmSync(assetsDst, { recursive: true, force: true });
cpSync(assetsSrc, assetsDst, { recursive: true });
writeFileSync(rootIndex, readFileSync(distIndex));
console.log('Published dist → repo root (index.html + assets/) for GitHub Pages');
