import { promises as fs } from 'fs';
import { join, dirname, relative, sep } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import ora from 'ora';
import prompts from 'prompts';
import { checkEnv, formatEnvReport } from '../../core/check-env.js';
import { DEFAULT_CONFIG, DEFAULT_ICON_SVG } from '../utils/config.js';
import { t } from '../i18n/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// dropcaster 自身の package.json から version を読む。生成プロジェクトの
// dependencies に書き込む際、固定文字列でハードコードするとリリース時に置き忘れる。
async function readDropcasterVersion() {
  const pkgPath = join(__dirname, '../../..', 'package.json');
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
  return pkg.version;
}

/**
 * root 配下に既に存在する相対パスを返す。
 * 書き込み先そのもの (パスの最後の要素) は lstat で調べ、シンボリックリンクならリンク先が
 * 無くても既存として数える (リンクを辿って書くと、利用者の知らない場所にファイルができるため)。
 * 途中のディレクトリがシンボリックリンクの場合は辿る。sketches/ を共有ディレクトリへリンクする
 * などは利用者の意図とみなし、リンク先の中で同じ検査をする。
 * 途中のディレクトリが通常ファイルで ENOTDIR になる場合は、その通常ファイル (例: public) を
 * 既存として数える。複数の書き込み先をふさぐ親も一覧には 1 度だけ載せる。
 * root 自身がディレクトリでない場合など、それ以外の失敗は例外として返す。
 * @param {string} root
 * @param {string[]} relPaths
 * @returns {Promise<string[]>}
 */
async function findExistingPaths(root, relPaths) {
  /** @type {Set<string>} */
  const existing = new Set();
  for (const rel of relPaths) {
    try {
      await fs.lstat(join(root, rel));
      existing.add(rel);
    } catch (error) {
      if (error?.code === 'ENOTDIR') {
        const blocker = await findNonDirectoryAncestor(root, rel);
        if (blocker) {
          existing.add(blocker);
          continue;
        }
      }
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return [...existing];
}

/**
 * rel の途中のディレクトリ (root 自身は含まない) のうち、ディレクトリでない最初のものを返す。
 * 途中のシンボリックリンクは辿って判定する。見つからなければ null。
 * @param {string} root
 * @param {string} rel
 * @returns {Promise<string | null>}
 */
async function findNonDirectoryAncestor(root, rel) {
  const segments = rel.split('/');
  for (let i = 1; i < segments.length; i++) {
    const prefix = segments.slice(0, i).join('/');
    const stats = await fs.stat(join(root, prefix)).catch(() => null);
    if (!stats) return null;
    if (!stats.isDirectory()) return prefix;
  }
  return null;
}

/**
 * projectPath 配下に dirs を作り、files を書き出す。既存のファイルは上書きしない
 * (wx。検査から書き込みまでの間に作られたファイルも EEXIST で失敗する)。
 * 途中で失敗したら、この呼び出しで作ったファイルと (空の) ディレクトリだけを消してから
 * 例外を投げ直す。書きかけを残すと、再実行時に自分が書いたものを衝突として報告してしまうため。
 * @param {string} projectPath
 * @param {string[]} dirs projectPath からの相対パス。親を先に並べる
 * @param {Array<[string, string]>} files projectPath からの相対パスと内容
 */
export async function writeProjectFiles(projectPath, dirs, files) {
  /** @type {string[]} この呼び出しで作ったディレクトリ (作った順) */
  const createdDirs = [];
  /** @type {string[]} この呼び出しで作ったファイル */
  const createdFiles = [];
  try {
    for (const dir of dirs) {
      const target = join(projectPath, dir);
      // recursive の mkdir は、最初に作ったディレクトリを返す (何も作らなければ undefined)
      const first = await fs.mkdir(target, { recursive: true });
      if (first) {
        const below = relative(first, target);
        createdDirs.push(first);
        if (below) {
          let current = first;
          for (const segment of below.split(sep)) {
            current = join(current, segment);
            createdDirs.push(current);
          }
        }
      }
    }
    for (const [rel, content] of files) {
      const target = join(projectPath, rel);
      // 作成と書き込みを分け、作成に成功した時点で自分のファイルとして記録する
      const handle = await fs.open(target, 'wx');
      createdFiles.push(target);
      try {
        await handle.writeFile(content, 'utf-8');
      } finally {
        await handle.close();
      }
    }
  } catch (error) {
    for (const file of createdFiles.reverse()) {
      await fs.rm(file, { force: true }).catch(() => {});
    }
    // 空でなければ rmdir は失敗するので、ほかの誰かが置いたものは消さない
    for (const dir of createdDirs.reverse()) {
      await fs.rmdir(dir).catch(() => {});
    }
    throw error;
  }
}

export async function init(options) {
  console.log(chalk.blue(t('init.starting')));

  // nameが指定されている場合、対話的プロンプトをスキップ
  let response = {};

  if (options.name) {
    // nameが指定されている場合はデフォルト値を使用
    console.log(chalk.gray(t('init.creating', { name: options.name })));
    response = {
      name: options.name,
      title: 'My Sketch Gallery',
      description: 'A collection of creative coding sketches',
      theme_color: '#000000'
    };
  } else {
    // nameが指定されていない場合のみプロンプトを表示
    response = await prompts([
      {
        type: 'text',
        name: 'name',
        message: t('init.prompt.projectName'),
        initial: 'my-sketch-gallery'
      },
      {
        type: 'text',
        name: 'title',
        message: t('init.prompt.galleryTitle'),
        initial: 'My Sketch Gallery'
      },
      {
        type: 'text',
        name: 'description',
        message: t('init.prompt.galleryDescription'),
        initial: 'A collection of creative coding sketches'
      },
      {
        type: 'text',
        name: 'theme_color',
        message: t('init.prompt.themeColor'),
        initial: '#000000'
      }
    ]);
  }

  const projectName = options.name || response.name;
  const projectPath = join(process.cwd(), projectName);

  const spinner = ora(t('init.creatingStructure')).start();
  
  try {
    // 書き出す内容をすべて組み立ててから、衝突の検査 → ディレクトリ作成 → 書き込みの順に進める。
    // 検査と書き込みを同じ一覧から行い、テンプレートを足したときに検査から漏れないようにする。

    // Create config file: DEFAULT_CONFIG をベースに、ユーザが prompt で答えたフィールドだけ上書き。
    // 上書きしないフィールド（background_color / display / start_url）は loadConfig() の
    // fallback と一致する。
    const config = {
      ...DEFAULT_CONFIG,
      title: response.title || 'My Sketch Gallery',
      description: response.description || DEFAULT_CONFIG.description,
      theme_color: response.theme_color || DEFAULT_CONFIG.theme_color,
    };
    
    // Create package.json
    // dropcaster の version を caret range で記述する。生成された package.json は
    // 別マシンに git clone されても解決可能でなければいけないので、ローカル file:
    // 絶対パスは使わない（公開前のローカル開発で必要なら、ユーザ側で `npm link
    // dropcaster` するか手動で書き換えてもらう）。
    const dropcasterVersion = await readDropcasterVersion();
    const packageJson = {
      name: projectName,
      version: '1.0.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'dropcaster dev',
        build: 'dropcaster build',
        scan: 'dropcaster scan',
        'scan:full': 'dropcaster scan --force-preview --fetch-userdata',
        'scan:reset': 'dropcaster scan:reset',
        preview: 'dropcaster preview'
      },
      dependencies: {
        dropcaster: `^${dropcasterVersion}`
      }
    };

    // Create .gitignore
    // ※ sketches/ と public/ は意図的に無視しない — GitHub Pages のデプロイにはこれらが必要。
    //   無視するのは依存・ビルド成果物・OS/エディタの一時ファイルのみ。
    const gitignore = `# 依存・ビルド成果物
node_modules/
dist/

# dev サーバの一時生成物 (\`dropcaster build\` が出力先に再生成するのでコミット不要。
# 特に sw.js は起動ごとに cacheVersion が変わり差分ノイズになる)
public/sw.js
public/manifest.json

# OS / エディタ
.DS_Store
*.log
.env
.cache/
.dropcaster/

# 注意:
#   sketches/ … 作品のソース
#   public/   … \`npm run scan\` が生成するメタデータ・プレビュー（sketches.json / sketches/ / previews/）
# どちらも git にコミットしてください。GitHub Pages へのデプロイに含まれます。
`;

    // Create README
    const readme = `# ${response.title || 'My Sketch Gallery'}

${response.description || 'A collection of creative coding sketches'}

## Getting Started

1. Install dependencies:
\`\`\`bash
npm install
\`\`\`

2. Add your sketches to \`sketches/\` directory

3. Scan sketches to generate metadata and copy to public:
\`\`\`bash
npm run scan
\`\`\`

4. Start development server:
\`\`\`bash
npm run dev
\`\`\`

5. Build for production:
\`\`\`bash
npm run build
\`\`\`

## Deployment

\`sketches/\`（作品ソース）と \`public/\`（\`npm run scan\` が生成するメタデータ・プレビュー）を
git にコミットしてください — GitHub Pages のデプロイにはこれらが必要です。

\`\`\`bash
npm run scan      # メタデータ・プレビューを更新（public/ に出力）
git add sketches public
git commit -m "Update gallery"
git push
\`\`\`

公開先での配信:
- **GitHub Pages**: \`npm run build\` で \`dist/\` を生成してデプロイ（GitHub Actions のワークフロー例は今後追加予定）
- **Netlify / Vercel**: ビルドコマンド \`npm run build\`、公開ディレクトリ \`dist\`

## Configuration

Edit \`dropcaster.config.js\` to customize your gallery.

---
Powered by [dropcaster](https://github.com/shinyaoguri/dropcaster)
`;

    // Create sample sketch in source directory
    const sampleHtml = `<!DOCTYPE html>
<html>
<head>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.7.0/p5.min.js"></script>
  <style>
    body { margin: 0; padding: 0; overflow: hidden; }
  </style>
</head>
<body>
  <script src="mySketch.js"></script>
</body>
</html>`;
    
    const sampleJs = `function setup() {
  createCanvas(windowWidth, windowHeight);
  colorMode(HSB, 360, 100, 100);
}

function draw() {
  background(0);
  
  for (let i = 0; i < 50; i++) {
    let x = random(width);
    let y = random(height);
    let size = random(5, 20);
    let hue = (frameCount + i * 10) % 360;
    
    fill(hue, 80, 100);
    noStroke();
    circle(x, y, size);
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}`;

    /** @type {Array<[string, string]>} projectPath からの相対パスと内容 */
    const files = [
      ['public/icon.svg', DEFAULT_ICON_SVG],
      ['dropcaster.config.js', `export default ${JSON.stringify(config, null, 2)};`],
      ['package.json', JSON.stringify(packageJson, null, 2)],
      ['.gitignore', gitignore],
      ['README.md', readme],
      ['sketches/sample-sketch/index.html', sampleHtml],
      ['sketches/sample-sketch/mySketch.js', sampleJs],
    ];

    // 既存プロジェクトの README・package.json・作品ソースを黙って置き換えない (#166)。
    // 1 件でも既にあれば、ディレクトリも含めて何も作らずに止める。
    const existing = await findExistingPaths(projectPath, files.map(([rel]) => rel));
    if (existing.length > 0) {
      spinner.fail(t('init.conflict', { dir: projectPath }));
      for (const rel of existing) console.error(chalk.red(`  ${rel}`));
      console.error(t('init.conflictHint'));
      process.exit(1);
    }

    // sketches/ は作品ソース、public/ は dropcaster scan が sketches.json / sketches/ / previews/ を
    // 生成する先。どちらも git にコミットして GitHub Pages のデプロイに含める
    const dirs = ['', 'sketches', 'sketches/sample-sketch', 'public', 'public/sketches', 'public/previews'];
    await writeProjectFiles(projectPath, dirs, files);

    spinner.succeed(t('init.created'));

    console.log();
    console.log(chalk.green(t('init.ready')));
    console.log();
    console.log(t('init.nextSteps'));
    console.log(chalk.cyan(`  cd ${projectName}`));
    console.log(chalk.cyan('  npm install'));
    console.log(chalk.cyan('  npm run scan'));
    console.log(chalk.cyan('  npm run dev'));
    console.log();

    // 環境チェック（FFmpeg / Chromium / Node）— プレビュー生成に必要なもの
    try {
      const report = await checkEnv();
      const envMessage = formatEnvReport(report, { title: t('env.titleInit') });
      if (envMessage) {
        console.log(envMessage);
        if (!report.ffmpeg.ok || !report.chromium.ok) {
          console.log(chalk.gray(t('init.missingToolsNote')));
        }
        console.log();
      }
    } catch {
      // 環境チェックの失敗は致命的ではないので無視
    }

  } catch (error) {
    spinner.fail(t('init.failed'));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}
