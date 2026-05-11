#!/usr/bin/env node

import { generateSketchPreview } from './modules/preview-generator.js';
import { resolve } from 'path';
import { mkdir } from 'fs/promises';

const sketchName = process.argv[2];
if (!sketchName) {
  console.error('Usage: node generate-single-preview.js <sketch-name>');
  process.exit(1);
}

// プロジェクトルートはカレントディレクトリ（scan-sketches.js と同じ方針）
const projectRoot = process.env.DROPCASTER_PROJECT_ROOT || process.cwd();
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