import { promises as fs } from 'fs';
import { join } from 'path';
import { DEFAULT_ICON_SVG } from './config.js';

export async function generateManifest(config, outputDir) {
  const startUrl = config.start_url || config.base || './';
  const scope = config.scope || config.base || './';
  const manifest = {
    name: config.title,
    short_name: config.title.substring(0, 12),
    description: config.description,
    start_url: startUrl,
    scope,
    display: config.display || 'standalone',
    background_color: config.background_color || '#ffffff',
    theme_color: config.theme_color || '#000000',
    orientation: 'any',
    icons: []
  };
  
  // Check for custom icons
  const iconPngPath = join(outputDir, 'icon.png');
  const iconSvgPath = join(outputDir, 'icon.svg');
  
  try {
    await fs.access(iconPngPath);
    manifest.icons = [
      {
        src: 'icon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable'
      }
    ];
  } catch {
    // Check for SVG icon
    try {
      await fs.access(iconSvgPath);
      manifest.icons = [
        {
          src: 'icon.svg',
          sizes: 'any',
          type: 'image/svg+xml',
          purpose: 'any maskable'
        }
      ];
    } catch {
      // No icon found, create a default one
      await fs.writeFile(iconSvgPath, DEFAULT_ICON_SVG, 'utf-8');
      manifest.icons = [
        {
          src: 'icon.svg',
          sizes: 'any',
          type: 'image/svg+xml',
          purpose: 'any maskable'
        }
      ];
    }
  }
  
  const manifestPath = join(outputDir, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  
  return manifest;
}
