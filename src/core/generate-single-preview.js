#!/usr/bin/env node

import { generateSketchPreview } from './modules/preview-generator.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdir } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sketchName = process.argv[2];
if (!sketchName) {
  console.error('Usage: node generate-single-preview.js <sketch-name>');
  process.exit(1);
}

const projectRoot = resolve(__dirname, '..');
const sketchPath = resolve(projectRoot, 'sketches', sketchName);
const previewsDir = resolve(projectRoot, 'public', 'previews');

// プレビューディレクトリを作成
await mkdir(previewsDir, { recursive: true });

console.log(`Generating preview for ${sketchName}...`);
console.log(`Sketch path: ${sketchPath}`);
console.log(`Previews dir: ${previewsDir}`);

const startTime = Date.now();
const result = await generateSketchPreview(sketchName, sketchPath, previewsDir, true);
const elapsed = Math.round((Date.now() - startTime) / 1000);

if (result) {
  console.log(`✅ Preview generated in ${elapsed} seconds: ${result}`);
} else {
  console.log(`❌ Failed to generate preview (took ${elapsed} seconds)`);
}