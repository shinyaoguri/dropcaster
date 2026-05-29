import { promises as fs } from 'fs';
import { join, dirname, resolve, sep } from 'path';
import { homedir } from 'os';
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
const rootDir = resolve(__dirname, '../../..'); // package root (src/cli/commands → repo root)

// クリーンビルドで `fs.rm` の対象になるディレクトリ。`--output .` や `--output ..`
// などでプロジェクト本体や親ディレクトリが消し飛ばないように、削除前にここで検証する。
const PROTECTED_SUBDIRS = ['src', 'sketches', 'content', 'public', 'node_modules', '.git'];

// config.title / config.description / config.theme_color などを index.html に差し込むときの
// 最低限の HTML エスケープ。text と attribute どちらに入れても安全な 5 文字を置換する。
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function assertSafeOutputDir(outputDir, cwd) {
  // 1. cwd と一致／cwd の祖先は拒否（`.`, `..`, 絶対パスで cwd を指す等を全部塞ぐ）
  if (outputDir === cwd) {
    throw new Error(`output directory must not be the current directory: ${outputDir}`);
  }
  const cwdWithSep = cwd.endsWith(sep) ? cwd : cwd + sep;
  const outWithSep = outputDir.endsWith(sep) ? outputDir : outputDir + sep;
  if (cwdWithSep.startsWith(outWithSep)) {
    throw new Error(`output directory must not be an ancestor of the current directory: ${outputDir}`);
  }

  // 2. ファイルシステムルートや $HOME 直下も拒否
  if (outputDir === sep || outputDir === homedir()) {
    throw new Error(`output directory must not be a system path: ${outputDir}`);
  }

  // 3. cwd 配下の保護対象（ソース／コンテンツ／.git 等）は拒否
  for (const name of PROTECTED_SUBDIRS) {
    const protectedPath = join(cwd, name);
    const protectedWithSep = protectedPath + sep;
    if (outputDir === protectedPath || outputDir.startsWith(protectedWithSep)) {
      throw new Error(`output directory must not be inside "${name}/": ${outputDir}`);
    }
  }

  // 4. 既存ディレクトリで .git を含むものは別プロジェクトのルートの可能性が高いので拒否
  //    （cwd 外への絶対パス指定でうっかり別リポジトリを消すのを防ぐ）
  let hasGit = false;
  try {
    await fs.access(join(outputDir, '.git'));
    hasGit = true;
  } catch (err) {
    // ENOENT 以外（権限など）は fs.rm 側に任せる
  }
  if (hasGit) {
    throw new Error(`refusing to clean output directory that contains .git: ${outputDir}`);
  }
}

export async function build(options) {
  const spinner = ora('Building for production...').start();
  
  try {
    // Load user config
    const config = await loadConfig(process.cwd());
    const outputDir = resolve(process.cwd(), options.output);

    // 出力先が cwd 自身／その祖先／保護対象サブディレクトリ等になっていないか検証
    // — `fs.rm(..., { recursive: true, force: true })` でプロジェクトや親ディレクトリを
    // 消し飛ばさないための安全弁。
    await assertSafeOutputDir(outputDir, process.cwd());

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
    
    // Generate Service Worker (multi-bucket cache; template at src/cli/utils/sw-template.js)
    spinner.text = 'Generating Service Worker...';
    await generateServiceWorker(outputDir);
    
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
    // 値は dropcaster.config.js 由来。`</title>` や `">` のような文字列を含むと
    // タグを閉じてしまうので、HTML エスケープしてから差し込む。
    indexHtml = indexHtml.replace(
      /<title>.*?<\/title>/,
      `<title>${escapeHtml(config.title)}</title>`
    );
    indexHtml = indexHtml.replace(
      /<meta name="description".*?>/,
      `<meta name="description" content="${escapeHtml(config.description)}">`
    );
    indexHtml = indexHtml.replace(
      /<meta name="theme-color".*?>/,
      `<meta name="theme-color" content="${escapeHtml(config.theme_color)}">`
    );

    // Ensure manifest link exists
    if (!indexHtml.includes('rel="manifest"')) {
      const basePath = options.base.replace(/\/?$/, '/');
      indexHtml = indexHtml.replace(
        '</head>',
        `  <link rel="manifest" href="${escapeHtml(basePath)}manifest.json">\n  </head>`
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
