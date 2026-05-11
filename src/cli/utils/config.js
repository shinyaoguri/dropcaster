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
  
  try {
    // Check if config file exists
    await fs.access(configPath);
    
    // Import the config file
    const configUrl = pathToFileURL(configPath).href;
    const { default: userConfig } = await import(configUrl);
    
    // Merge with defaults
    return {
      ...defaultConfig,
      ...userConfig
    };
  } catch (error) {
    // Return default config if file doesn't exist
    console.warn('No dropcaster.config.js found, using defaults');
    return defaultConfig;
  }
}

export async function saveConfig(projectPath, config) {
  const configPath = join(projectPath, 'dropcaster.config.js');
  const configContent = `export default ${JSON.stringify(config, null, 2)};`;
  
  await fs.writeFile(configPath, configContent, 'utf-8');
}