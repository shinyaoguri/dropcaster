import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import { t } from '../i18n/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * sketches/ を走査して public/sketches.json を更新する（子プロセスで scan-sketches.js を実行）。
 * @param {object} [options] commander から渡る scan コマンドのオプション
 * @param {string} [options.sketch]        指定名のスケッチだけ走査する
 * @param {boolean} [options.previews]     false（--no-previews）ならプレビュー生成を省く
 * @param {boolean} [options.forcePreview] 最新のプレビューでも再生成する
 * @param {boolean} [options.reset]        既存プレビューを捨てて作り直す
 * @param {boolean} [options.fetchUserdata] OpenProcessing Public API で作者・タイトルを取得する
 * @param {boolean} [options.verbose]      子プロセスの出力をそのまま流す
 * @returns {Promise<void>} 子プロセスが正常終了したら解決、非 0 終了なら reject
 */
export async function scan(options = {}) {
  console.log(chalk.cyan('\n🔍 Scanning sketches...\n'));

  // プロジェクトルートのパスを取得
  const projectRoot = process.cwd();
  
  // sketchesディレクトリの存在確認
  const sketchesDir = resolve(projectRoot, 'sketches');
  if (!existsSync(sketchesDir)) {
    console.error(chalk.red(t('scan.sketchesNotFound', { dir: sketchesDir })));
    console.log(chalk.yellow(t('scan.hintRunInProjectRoot')));
    process.exit(1);
  }
  
  // scan-sketches.jsのパスを解決（src/cli/commands → src/core）
  const scanScriptPath = resolve(__dirname, '../../core/scan-sketches.js');
  
  // コマンドライン引数を構築
  const args = ['--write-file'];
  
  // オプションに応じた引数を追加
  if (options.sketch) {
    args.push('--sketch', options.sketch);
  }
  
  // プレビュー GIF はデフォルトで生成（--no-previews でスキップ）
  if (options.previews !== false) {
    args.push('--generate-previews');
    // --force-preview: 最新のプレビューでも再生成する
    if (options.forcePreview) {
      args.push('--force-regenerate');
    }
  }

  if (options.reset) {
    args.push('--reset');
  }

  // ユーザーデータ取得（タイトル・作者）は OpenProcessing Public API 経由
  if (options.fetchUserdata) {
    args.push('--fetch-userdata');
  }

  // スピナーを開始
  let spinner;
  const inheritStdio = options.verbose || options.fetchUserdata;
  if (!inheritStdio) {
    spinner = ora('Scanning sketches...').start();
  }
  
  return new Promise((fulfill, reject) => {
    // 環境変数を設定してscan-sketches.jsを実行
    const env = {
      ...process.env,
      DROPCASTER_PROJECT_ROOT: projectRoot
    };
    
    const scanProcess = spawn('node', [scanScriptPath, ...args], {
      env,
      // stdout は使わない（sketches.json は scan-sketches.js が --write-file で書き込む）。
      // stderr は進捗表示のため pipe して解析する。
      stdio: inheritStdio ? 'inherit' : ['ignore', 'ignore', 'pipe']
    });

    let stderr = '';

    if (!inheritStdio) {
      scanProcess.stderr.on('data', (data) => {
        const dataStr = data.toString();
        stderr += dataStr;
        
        // プログレス情報を表示
        const lines = dataStr.split('\n');
        for (const line of lines) {
          const trimmedLine = line.trim();
          
          // フレームキャプチャの進捗表示（\rで上書き）
          if (trimmedLine.includes('Frame') && trimmedLine.includes('%')) {
            if (spinner) {
              spinner.stop();
              spinner = null;
            }
            // \rを使って同じ行に上書き表示
            process.stdout.write('\r' + trimmedLine);
          }
          // その他の進捗メッセージ
          else if (trimmedLine.includes('✓') || trimmedLine.includes('📸') || trimmedLine.includes('🎬')) {
            if (trimmedLine.includes('📸')) {
              // プレビュー生成開始時はスピナーを停止
              if (spinner) {
                spinner.stop();
                spinner = null;
              }
              console.log(trimmedLine);
            } else if (trimmedLine.includes('🎬')) {
              // GIF変換メッセージ（Frame進捗の後なので改行を入れる）
              console.log(''); // 改行
              console.log(trimmedLine);
            } else if (spinner) {
              spinner.text = trimmedLine;
            }
          }
          // 最終的な確認メッセージ
          else if (trimmedLine.includes('📋')) {
            if (spinner) {
              spinner.stop();
              spinner = null;
            }
            console.error(''); // 改行
            console.error(trimmedLine);
          }
        }
      });
    }
    
    scanProcess.on('close', async (code) => {
      if (spinner) {
        spinner.stop();
      }
      
      if (code === 0) {
        // sketches.json は scan-sketches.js が --write-file で書き込み済み。
        // ここでは表示用に読み直すだけ（多重書き込みを避ける）。
        if (!inheritStdio) {
          const sketchesJsonPath = resolve(projectRoot, 'public/sketches.json');
          try {
            const sketches = JSON.parse(await fs.readFile(sketchesJsonPath, 'utf-8'));
            console.log(chalk.green(t('scan.scanned', { count: sketches.length })));

            const withPreviews = sketches.filter(s => s.previewGif).length;
            if (withPreviews > 0) {
              console.log(chalk.gray(t('scan.previewsGenerated', { ok: withPreviews, total: sketches.length })));
            }
            console.log(chalk.gray(t('scan.savedTo', { path: sketchesJsonPath })));
          } catch (e) {
            console.log(chalk.green(t('scan.completed')));
          }

          // stderr の最終確認メッセージ（💾）を表示（📋 は既に表示済み）
          if (stderr) {
            for (const line of stderr.split('\n')) {
              if (line.includes('💾')) {
                console.log(chalk.gray(line));
              }
            }
          }
        }

        fulfill();
      } else {
        // エラー時の処理
        console.error(chalk.red(t('scan.failed', { code })));
        if (stderr) {
          console.error(chalk.red('Error details:'));
          console.error(stderr);
        }
        reject(new Error(`Scan failed with exit code ${code}`));
      }
    });

    scanProcess.on('error', (err) => {
      if (spinner) {
        spinner.stop();
      }
      console.error(chalk.red(t('scan.startFailed')), err.message);
      reject(err);
    });
  });
}

// scan:resetコマンド用のヘルパー関数
export async function scanReset(options = {}) {
  console.log(chalk.cyan('\n🔄 Resetting and regenerating all previews...\n'));
  console.log(chalk.yellow('⚠️  This will regenerate all preview images. It may take several minutes.\n'));
  
  return scan({
    ...options,
    reset: true,
    verbose: true  // resetの場合は常に詳細表示
  });
}
