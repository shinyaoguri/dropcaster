import { promises as fs } from 'fs';
import { join } from 'path';

export async function generateManifest(config, outputDir) {
  const manifest = {
    name: config.title,
    short_name: config.title.substring(0, 12),
    description: config.description,
    start_url: config.start_url || '/',
    display: config.display || 'standalone',
    background_color: config.background_color || '#ffffff',
    theme_color: config.theme_color || '#000000',
    orientation: 'any',
    icons: []
  };
  
  // Check for custom icons
  const iconPath = join(outputDir, 'icon.png');
  try {
    await fs.access(iconPath);
    manifest.icons = [
      {
        src: '/icon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable'
      }
    ];
  } catch {
    // Use default icon
    manifest.icons = [
      {
        src: '/vite.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any maskable'
      }
    ];
  }
  
  const manifestPath = join(outputDir, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  
  return manifest;
}