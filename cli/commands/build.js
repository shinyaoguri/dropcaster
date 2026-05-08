import { promises as fs } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { build as viteBuild } from 'vite';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../utils/config.js';
import { generateManifest } from '../utils/manifest.js';
import { generateServiceWorker } from '../utils/service-worker.js';
import { copyPublicFiles } from '../utils/files.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '../..');

export async function build(options) {
  const spinner = ora('Building for production...').start();
  
  try {
    // Load user config
    const config = await loadConfig(process.cwd());
    const outputDir = resolve(process.cwd(), options.output);
    
    // Clean output directory
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.mkdir(outputDir, { recursive: true });
    
    // Copy public files
    spinner.text = 'Copying public files...';
    await copyPublicFiles(
      join(process.cwd(), 'public'),
      outputDir
    );
    
    // Generate PWA manifest
    spinner.text = 'Generating PWA manifest...';
    const manifestStartUrl = config.start_url === '/' ? options.base : config.start_url;
    await generateManifest({
      ...config,
      base: options.base,
      start_url: manifestStartUrl || options.base,
      scope: config.scope || options.base
    }, outputDir);
    
    // Generate Service Worker
    spinner.text = 'Generating Service Worker...';
    await generateServiceWorker(config, outputDir);
    
    // Build with Vite
    spinner.text = 'Building application...';
    await viteBuild({
      root: rootDir,
      base: options.base,
      mode: 'production',
      publicDir: false,  // Don't copy public dir from package
      build: {
        outDir: outputDir,
        emptyOutDir: false,
        minify: 'terser',  // より高度な圧縮
        terserOptions: {
          compress: {
            drop_console: true,  // console.logを削除
            drop_debugger: true  // debuggerを削除
          }
        },
        reportCompressedSize: false,  // gzip圧縮サイズ計算をスキップ（ビルド高速化）
        chunkSizeWarningLimit: 1000,  // チャンクサイズ警告の閾値を上げる
        rollupOptions: {
          input: {
            main: join(rootDir, 'index.html')
          },
          output: {
            // コード分割の最適化
            manualChunks: (id) => {
              // node_modulesのコードを vendor チャンクに分離
              if (id.includes('node_modules')) {
                return 'vendor';
              }
            },
            // アセット名を短縮
            assetFileNames: 'assets/[name].[hash:8][extname]',
            chunkFileNames: 'assets/[name].[hash:8].js',
            entryFileNames: 'assets/[name].[hash:8].js'
          }
        },
        cssCodeSplit: true,  // CSSコード分割を有効化
        sourcemap: false,  // ソースマップを無効化（プロダクション用）
        target: 'es2015',  // より広いブラウザサポート
        assetsInlineLimit: 4096  // 4KB以下のアセットをインライン化
      },
      define: {
        'import.meta.env.DROPCASTER_CONFIG': JSON.stringify(config),
        'import.meta.env.BASE_URL': JSON.stringify(options.base)
      }
    });
    
    // Copy and modify index.html
    spinner.text = 'Finalizing build...';
    const indexPath = join(outputDir, 'index.html');
    let indexHtml = await fs.readFile(indexPath, 'utf-8');
    
    // Update title and meta tags
    indexHtml = indexHtml.replace(
      /<title>.*?<\/title>/,
      `<title>${config.title}</title>`
    );
    indexHtml = indexHtml.replace(
      /<meta name="description".*?>/,
      `<meta name="description" content="${config.description}">`
    );
    indexHtml = indexHtml.replace(
      /<meta name="theme-color".*?>/,
      `<meta name="theme-color" content="${config.theme_color}">`
    );
    
    // Ensure manifest link exists
    if (!indexHtml.includes('rel="manifest"')) {
      const basePath = options.base.replace(/\/?$/, '/');
      indexHtml = indexHtml.replace(
        '</head>',
        `  <link rel="manifest" href="${basePath}manifest.json">\n  </head>`
      );
    }
    
    await fs.writeFile(indexPath, indexHtml, 'utf-8');
    
    // Create sketches.json if it doesn't exist
    const sketchesJsonPath = join(outputDir, 'sketches.json');
    if (!await fs.access(sketchesJsonPath).then(() => true).catch(() => false)) {
      await fs.writeFile(sketchesJsonPath, '[]', 'utf-8');
    }
    
    spinner.succeed('Build completed successfully!');
    
    console.log();
    console.log(chalk.green(`✨ Built to ${chalk.bold(options.output)}`));
    console.log();
    console.log('Deploy this directory to any static hosting service:');
    console.log(chalk.gray('  - GitHub Pages'));
    console.log(chalk.gray('  - Netlify'));
    console.log(chalk.gray('  - Vercel'));
    console.log(chalk.gray('  - Surge.sh'));
    console.log();
    
  } catch (error) {
    spinner.fail('Build failed');
    console.error(chalk.red(error.message));
    console.error(error.stack);
    process.exit(1);
  }
}
