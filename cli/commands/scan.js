import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import chalk from 'chalk';
import ora from 'ora';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function scan(options = {}) {
  console.log(chalk.cyan('\n🔍 Scanning sketches...\n'));
  
  // デバッグ: オプションを確認
  if (options.verbose) {
    console.log(chalk.gray('Options received:'), options);
  }
  
  // プロジェクトルートのパスを取得
  const projectRoot = process.cwd();
  
  // sketchesディレクトリの存在確認
  const sketchesDir = resolve(projectRoot, 'sketches');
  if (!existsSync(sketchesDir)) {
    console.error(chalk.red(`❌ sketchesディレクトリが見つかりません: ${sketchesDir}`));
    console.log(chalk.yellow('💡 ヒント: dropcasterプロジェクトのルートディレクトリで実行してください'));
    process.exit(1);
  }
  
  // scan-sketches.jsのパスを解決
  const scanScriptPath = resolve(__dirname, '../../scripts/scan-sketches.js');
  
  // コマンドライン引数を構築
  const args = ['--write-file'];
  
  // オプションに応じた引数を追加
  if (options.sketch) {
    args.push('--sketch', options.sketch);
  }
  
  if (options.forcePreview) {
    args.push('--force-preview');
  }
  
  if (options.reset) {
    args.push('--reset');
  }
  
  // ユーザーデータ取得は OpenProcessing Public API がデフォルト。
  // --external-browser を付けた場合のみ OS 既定ブラウザを開く手動フロー（dropcaster.meta.json を手書き）になる。
  if (options.fetchUserdata) {
    args.push('--fetch-userdata');
    if (options.externalBrowser) {
      args.push('--external-browser');
    }
  }

  if (options.externalBrowser && options.externalBrowserIntervalMs) {
    args.push('--external-browser-interval-ms', options.externalBrowserIntervalMs);
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
      stdio: inheritStdio ? 'inherit' : 'pipe'
    });
    
    let stdout = '';
    let stderr = '';
    
    if (!inheritStdio) {
      scanProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
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
        // 成功時の処理
        if (!inheritStdio && stdout) {
          // JSONを解析してスケッチ数を表示
          try {
            const sketches = JSON.parse(stdout);
            const sketchesJsonPath = resolve(projectRoot, 'public/sketches.json');
            await fs.mkdir(resolve(projectRoot, 'public'), { recursive: true });
            await fs.writeFile(sketchesJsonPath, JSON.stringify(sketches, null, 2), 'utf-8');
            console.log(chalk.green(`✅ ${sketches.length}個のスケッチをスキャンしました`));
            
            // プレビュー生成状況を表示
            const withPreviews = sketches.filter(s => s.previewGif).length;
            if (withPreviews > 0) {
              console.log(chalk.gray(`   プレビュー生成済み: ${withPreviews}/${sketches.length}`));
            }
            console.log(chalk.gray(`   保存先: ${sketchesJsonPath}`));
          } catch (e) {
            // JSON解析に失敗した場合は生のメッセージを表示
            console.log(chalk.green('✅ スキャンが完了しました'));
          }
        }
        
        // stderrの最終確認メッセージを表示（すでに表示済みのものは除く）
        if (!inheritStdio && stderr) {
          const lines = stderr.split('\n');
          for (const line of lines) {
            // 💾のみ表示（📋は既に表示済み）
            if (line.includes('💾')) {
              console.log(chalk.gray(line));
            }
          }
        }
        
        fulfill();
      } else {
        // エラー時の処理
        console.error(chalk.red(`❌ スキャンに失敗しました (exit code: ${code})`));
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
      console.error(chalk.red('❌ スキャンプロセスの起動に失敗しました:'), err.message);
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
