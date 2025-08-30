import { createServer } from 'vite';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { loadConfig } from '../utils/config.js';
import { generateManifest } from '../utils/manifest.js';
import { promises as fs } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '../..');

export async function dev(options) {
  try {
    console.log(chalk.blue('🚀 Starting development server...'));
    
    // Load user config
    const config = await loadConfig(process.cwd());
    const publicDir = join(process.cwd(), 'public');
    
    // Ensure public directory exists
    await fs.mkdir(publicDir, { recursive: true });
    
    // Generate manifest.json in public directory
    await generateManifest(config, publicDir);
    
    // Create dev service worker (minimal caching for PWA testing)
    const devServiceWorker = `
// Development Service Worker - Minimal caching for PWA testing
const CACHE_NAME = 'dropcaster-dev-v1';
const urlsToCache = [
  '/',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  // For development, always fetch from network except for the manifest
  if (event.request.url.includes('/manifest.json')) {
    event.respondWith(
      caches.match(event.request)
        .then((response) => {
          return response || fetch(event.request);
        })
    );
  } else {
    // Always fetch from network for other resources
    event.respondWith(fetch(event.request));
  }
});`;
    
    await fs.writeFile(join(publicDir, 'sw.js'), devServiceWorker, 'utf-8');
    
    // Create Vite server
    const server = await createServer({
      root: rootDir,
      mode: 'development',
      server: {
        port: parseInt(options.port),
        host: options.host === 'localhost' ? 'localhost' : true,
        fs: {
          allow: [rootDir, process.cwd()]
        }
      },
      define: {
        'import.meta.env.DROPCASTER_CONFIG': JSON.stringify(config),
        'import.meta.env.BASE_URL': JSON.stringify('/')
      },
      publicDir: publicDir
    });
    
    await server.listen();
    
    const url = `http://${options.host}:${options.port}`;
    
    console.log();
    console.log(chalk.green('✨ Development server started!'));
    console.log();
    console.log(`  ${chalk.bold('Local:')}   ${chalk.cyan(url)}`);
    if (options.host !== 'localhost') {
      const networkUrl = `http://${getNetworkAddress()}:${options.port}`;
      console.log(`  ${chalk.bold('Network:')} ${chalk.cyan(networkUrl)}`);
    }
    console.log();
    console.log(chalk.gray('Press Ctrl+C to stop'));
    console.log();
    
  } catch (error) {
    console.error(chalk.red('Failed to start development server'));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}

function getNetworkAddress() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  
  return 'localhost';
}