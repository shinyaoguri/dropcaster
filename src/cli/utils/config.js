import { promises as fs } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

// PWA / manifest 用のデフォルト値。dropcaster.config.js が無い時の fallback と
// init コマンドが書き出す初期 config の土台として共用する。両者で zureる可能性を
// 物理的に断つために 1 か所で定義。
export const DEFAULT_CONFIG = {
  title: 'Sketch Gallery',
  description: 'A collection of creative coding sketches',
  theme_color: '#000000',
  background_color: '#ffffff',
  display: 'standalone',
  start_url: '/'
};

// dropcaster init / manifest 生成のいずれでも、ユーザがアイコンを置いていない
// 時に書き出す既定 SVG。両所で違うアイコンが書かれないよう 1 か所に集約。
export const DEFAULT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  <rect width="512" height="512" rx="64" fill="#000"/>
  <circle cx="256" cy="256" r="180" fill="#fff"/>
  <circle cx="256" cy="256" r="120" fill="#000"/>
  <circle cx="256" cy="256" r="60" fill="#fff"/>
</svg>`;

export async function loadConfig(projectPath) {
  const configPath = join(projectPath, 'dropcaster.config.js');

  // 「ファイルが存在しない」と「ファイルはあるが構文／import エラー」は別物として扱う。
  // 後者をデフォルト設定で握りつぶすと、誤った内容のままビルドが通って公開されるので、
  // ENOENT 以外は素直に投げて build を止める。
  try {
    await fs.access(configPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      console.warn('No dropcaster.config.js found, using defaults');
      return DEFAULT_CONFIG;
    }
    throw error;
  }

  const configUrl = pathToFileURL(configPath).href;
  const { default: userConfig } = await import(configUrl);

  return {
    ...DEFAULT_CONFIG,
    ...userConfig
  };
}

export async function saveConfig(projectPath, config) {
  const configPath = join(projectPath, 'dropcaster.config.js');
  const configContent = `export default ${JSON.stringify(config, null, 2)};`;
  
  await fs.writeFile(configPath, configContent, 'utf-8');
}