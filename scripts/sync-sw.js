#!/usr/bin/env node
// src/cli/utils/sw-template.js (正本) を public/sw.js と apps/web/public/sw.js に同期する。
// npm run build / build:web の prebuild フックから呼ばれる。

import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const templatePath = join(rootDir, 'src/cli/utils/sw-template.js');
const targets = [
  join(rootDir, 'public/sw.js'),
  join(rootDir, 'apps/web/public/sw.js'),
];

const content = await fs.readFile(templatePath, 'utf-8');
for (const target of targets) {
  await fs.mkdir(dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf-8');
  console.log(`sync-sw: ${target}`);
}
