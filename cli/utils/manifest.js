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
  const iconPngPath = join(outputDir, 'icon.png');
  const iconSvgPath = join(outputDir, 'icon.svg');
  
  try {
    await fs.access(iconPngPath);
    manifest.icons = [
      {
        src: '/icon.png',
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
          src: '/icon.svg',
          sizes: 'any',
          type: 'image/svg+xml',
          purpose: 'any maskable'
        }
      ];
    } catch {
      // No icon found, create a default one
      const defaultIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  <rect width="512" height="512" rx="64" fill="#000"/>
  <circle cx="256" cy="256" r="180" fill="#fff"/>
  <circle cx="256" cy="256" r="120" fill="#000"/>
  <circle cx="256" cy="256" r="60" fill="#fff"/>
</svg>`;
      await fs.writeFile(iconSvgPath, defaultIcon, 'utf-8');
      manifest.icons = [
        {
          src: '/icon.svg',
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