import { promises as fs } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const defaultConfig = {
  title: 'Sketch Gallery',
  description: 'A collection of creative coding sketches',
  theme_color: '#000000',
  background_color: '#ffffff',
  display: 'standalone',
  start_url: '/'
};

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
      return defaultConfig;
    }
    throw error;
  }

  const configUrl = pathToFileURL(configPath).href;
  const { default: userConfig } = await import(configUrl);

  return {
    ...defaultConfig,
    ...userConfig
  };
}

export async function saveConfig(projectPath, config) {
  const configPath = join(projectPath, 'dropcaster.config.js');
  const configContent = `export default ${JSON.stringify(config, null, 2)};`;
  
  await fs.writeFile(configPath, configContent, 'utf-8');
}