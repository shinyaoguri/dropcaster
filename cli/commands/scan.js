import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
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
  const args = [];
  
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
  
  if (options.fetchUserdata) {
    args.push('--fetch-userdata');
  }
  
  // スピナーを開始
  let spinner;
  if (!options.verbose) {
    spinner = ora('Scanning sketches...').start();
  }
  
  return new Promise((resolve, reject) => {
    // 環境変数を設定してscan-sketches.jsを実行
    const env = {
      ...process.env,
      DROPCASTER_PROJECT_ROOT: projectRoot
    };
    
    const scanProcess = spawn('node', [scanScriptPath, ...args], {
      env,
      stdio: options.verbose ? 'inherit' : 'pipe'
    });
    
    let stdout = '';
    let stderr = '';
    
    if (!options.verbose) {
      scanProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      scanProcess.stderr.on('data', (data) => {
        stderr += data.toString();
        // プログレス情報を表示
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.includes('✓') || line.includes('📸') || line.includes('🎬')) {
            if (spinner) {
              spinner.text = line.trim();
            }
          }
        }
      });
    }
    
    scanProcess.on('close', (code) => {
      if (spinner) {
        spinner.stop();
      }
      
      if (code === 0) {
        // 成功時の処理
        if (!options.verbose && stdout) {
          // JSONを解析してスケッチ数を表示
          try {
            const sketches = JSON.parse(stdout);
            console.log(chalk.green(`✅ ${sketches.length}個のスケッチをスキャンしました`));
            
            // プレビュー生成状況を表示
            const withPreviews = sketches.filter(s => s.preview).length;
            if (withPreviews > 0) {
              console.log(chalk.gray(`   プレビュー生成済み: ${withPreviews}/${sketches.length}`));
            }
          } catch (e) {
            // JSON解析に失敗した場合は生のメッセージを表示
            console.log(chalk.green('✅ スキャンが完了しました'));
          }
        }
        
        // stderrの重要な情報を表示
        if (!options.verbose && stderr) {
          const lines = stderr.split('\n');
          for (const line of lines) {
            if (line.includes('📋') || line.includes('💾')) {
              console.log(chalk.gray(line));
            }
          }
        }
        
        resolve();
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