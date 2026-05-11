import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import ora from 'ora';
import prompts from 'prompts';
import { checkEnv, formatEnvReport } from '../../core/check-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function init(options) {
  console.log(chalk.blue('🚀 Initializing new dropcaster project...'));
  
  // nameが指定されている場合、対話的プロンプトをスキップ
  let response = {};
  
  if (options.name) {
    // nameが指定されている場合はデフォルト値を使用
    console.log(chalk.gray(`Creating project: ${options.name}`));
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
        message: 'Project name:',
        initial: 'my-sketch-gallery'
      },
      {
        type: 'text',
        name: 'title',
        message: 'Gallery title:',
        initial: 'My Sketch Gallery'
      },
      {
        type: 'text',
        name: 'description',
        message: 'Gallery description:',
        initial: 'A collection of creative coding sketches'
      },
      {
        type: 'text',
        name: 'theme_color',
        message: 'Theme color:',
        initial: '#000000'
      }
    ]);
  }

  const projectName = options.name || response.name;
  const projectPath = join(process.cwd(), projectName);
  
  const spinner = ora('Creating project structure...').start();
  
  try {
    // Create project directory
    await fs.mkdir(projectPath, { recursive: true });
    
    // Create source sketches directory（作品ソース。git にコミットする）
    await fs.mkdir(join(projectPath, 'sketches'), { recursive: true });

    // Create public directory（dropcaster scan が sketches.json / sketches/ / previews/ を生成。
    // これらも git にコミットして GitHub Pages のデプロイに含める）
    await fs.mkdir(join(projectPath, 'public'), { recursive: true });
    await fs.mkdir(join(projectPath, 'public/sketches'), { recursive: true });
    await fs.mkdir(join(projectPath, 'public/previews'), { recursive: true });
    
    // Create default icon (simple SVG)
    const defaultIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  <rect width="512" height="512" rx="64" fill="#000"/>
  <circle cx="256" cy="256" r="180" fill="#fff"/>
  <circle cx="256" cy="256" r="120" fill="#000"/>
  <circle cx="256" cy="256" r="60" fill="#fff"/>
</svg>`;
    await fs.writeFile(join(projectPath, 'public/icon.svg'), defaultIcon, 'utf-8');
    
    // Create config file
    const config = {
      title: response.title || 'My Sketch Gallery',
      description: response.description || 'A collection of creative coding sketches',
      theme_color: response.theme_color || '#000000',
      background_color: '#ffffff',
      display: 'standalone',
      start_url: '/'
    };
    
    await fs.writeFile(
      join(projectPath, 'dropcaster.config.js'),
      `export default ${JSON.stringify(config, null, 2)};`,
      'utf-8'
    );
    
    // Create package.json
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
        dropcaster: `file:${join(__dirname, '../../..')}`
      }
    };
    
    await fs.writeFile(
      join(projectPath, 'package.json'),
      JSON.stringify(packageJson, null, 2),
      'utf-8'
    );
    
    // Create .gitignore
    // ※ sketches/ と public/ は意図的に無視しない — GitHub Pages のデプロイにはこれらが必要。
    //   無視するのは依存・ビルド成果物・OS/エディタの一時ファイルのみ。
    const gitignore = `# 依存・ビルド成果物
node_modules/
dist/

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

    await fs.writeFile(join(projectPath, '.gitignore'), gitignore, 'utf-8');
    
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
    
    await fs.writeFile(join(projectPath, 'README.md'), readme, 'utf-8');
    
    // Create sample sketch in source directory
    const sampleSketchPath = join(projectPath, 'sketches/sample-sketch');
    await fs.mkdir(sampleSketchPath, { recursive: true });
    
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
    
    await fs.writeFile(join(sampleSketchPath, 'index.html'), sampleHtml, 'utf-8');
    await fs.writeFile(join(sampleSketchPath, 'mySketch.js'), sampleJs, 'utf-8');
    
    spinner.succeed('Project created successfully!');
    
    console.log();
    console.log(chalk.green('✨ Your dropcaster project is ready!'));
    console.log();
    console.log('Next steps:');
    console.log(chalk.cyan(`  cd ${projectName}`));
    console.log(chalk.cyan('  npm install'));
    console.log(chalk.cyan('  npm run scan'));
    console.log(chalk.cyan('  npm run dev'));
    console.log();

    // 環境チェック（FFmpeg / Chromium / Node）— プレビュー生成に必要なもの
    try {
      const report = await checkEnv();
      const envMessage = formatEnvReport(report, { title: '環境チェック（プレビュー生成に必要）' });
      if (envMessage) {
        console.log(envMessage);
        if (!report.ffmpeg.ok || !report.chromium.ok) {
          console.log(chalk.gray('  ※ 不足分はプレビュー GIF 生成にのみ必要です。後から入れてもOK（`dropcaster doctor` で再確認）。'));
        }
        console.log();
      }
    } catch {
      // 環境チェックの失敗は致命的ではないので無視
    }

  } catch (error) {
    spinner.fail('Failed to create project');
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}
