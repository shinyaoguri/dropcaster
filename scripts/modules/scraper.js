import puppeteer from 'puppeteer';
import { mkdir } from 'fs/promises';
import { resolve } from 'path';
import { spawn } from 'child_process';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { SCRAPING_CONFIG, DEFAULTS } from './config.js';

export class OpenProcessingScraper {
  constructor(options = {}) {
    this.browser = null;
    this.lastExternalBrowserOpenAt = 0;
    this.options = {
      headed: Boolean(options.headed),
      externalBrowser: Boolean(options.externalBrowser),
      browserProfile: options.browserProfile || null,
      manualChallenge: options.manualChallenge ?? Boolean(options.headed),
      challengeTimeoutMs: Number(options.challengeTimeoutMs || 180000),
      externalBrowserIntervalMs: Math.max(
        Number(options.externalBrowserIntervalMs || SCRAPING_CONFIG.externalBrowserIntervalMs || 1000),
        1000
      )
    };
  }

  async init() {
    if (this.options.externalBrowser) {
      console.error('🌐 External browser mode: OSの既定ブラウザでOpenProcessingを開きます');
      console.error('   Puppeteerでは取得せず、手動メタデータ用の雛形を作成します');
      return;
    }

    const args = [];
    const launchOptions = {
      headless: !this.options.headed,
      args
    };

    if (this.options.headed) {
      args.push('--start-maximized');
      launchOptions.defaultViewport = null;
      console.error('🧑‍💻 Headed browser mode: OpenProcessingの確認画面が出たら、開いたブラウザで操作してください');
    }

    if (this.options.browserProfile) {
      const profilePath = resolve(this.options.browserProfile);
      await mkdir(profilePath, { recursive: true });
      launchOptions.userDataDir = profilePath;
      console.error(`👤 Browser profile: ${profilePath}`);
    }

    if (!this.options.headed || process.env.DROPCASTER_NO_SANDBOX === '1') {
      args.push('--no-sandbox', '--disable-setuid-sandbox');
    }

    this.browser = await puppeteer.launch({
      ...launchOptions
    });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async getSketchUserInfo(sketchId) {
    const url = `${SCRAPING_CONFIG.baseUrl}/sketch/${sketchId}`;

    if (this.options.externalBrowser) {
      await this.waitForExternalBrowserInterval(sketchId);
      await openExternalBrowser(url);
      this.lastExternalBrowserOpenAt = Date.now();
      return {
        error: 'Opened in external browser. Fill dropcaster.meta.json manually.',
        sketchId
      };
    }

    let page = null;
    try {
      page = await this.browser.newPage();

      if (!this.options.headed && SCRAPING_CONFIG.userAgent) {
        await page.setUserAgent(SCRAPING_CONFIG.userAgent);
      }

      // ページ内のコンソールログをキャプチャ
      page.on('console', msg => {
        if (msg.type() === 'log') {
          console.error(`📄 ページ内ログ [${sketchId}]:`, msg.text());
        }
      });
      
      console.error(`🔍 アクセス中: ${url}`);
      
      // ページの読み込み状況を詳細にログ出力
      console.error(`⏱️ [${sketchId}] ページ読み込み開始...`);
      
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: SCRAPING_CONFIG.pageLoadTimeout 
      });
      
      console.error(`⏱️ [${sketchId}] ページ読み込み完了、待機開始...`);
      
      // ページの読み込みを待つ
      await new Promise(resolve => setTimeout(resolve, SCRAPING_CONFIG.pageWaitTime));
      await this.handleChallengeIfNeeded(page, sketchId);
      
      console.error(`⏱️ [${sketchId}] 待機完了、ページ内容確認開始...`);
      
      // ページが正しく読み込まれているか確認
      const title = await page.title();
      console.error(`📄 [${sketchId}] ページタイトル: "${title}"`);
      
      if (title.includes('404') || title.includes('Not Found')) {
        throw new Error(`スケッチ ${sketchId} が見つかりません`);
      }
      
      // ページの内容が読み込まれるまで待機
      try {
        await page.waitForSelector('body', { timeout: SCRAPING_CONFIG.elementWaitTimeout });
        console.error(`✅ [${sketchId}] body要素の読み込み完了`);
        
        // より具体的な要素の読み込みを待機
        try {
          await page.waitForSelector('.sketchInfo, .sketchAuthor, .userThumbContainer', { 
            timeout: SCRAPING_CONFIG.elementWaitTimeoutShort 
          });
          console.error(`✅ [${sketchId}] スケッチ情報要素の読み込み完了`);
        } catch (error) {
          console.error(`⚠️ [${sketchId}] スケッチ情報要素の読み込みタイムアウト:`, error.message);
        }
        
      } catch (error) {
        console.error(`⚠️ [${sketchId}] ページ読み込みタイムアウト:`, error.message);
      }
      
      // ページのHTML内容を確認（デバッグ用）
      const pageContent = await page.content();
      const hasSketchAuthor = pageContent.includes('sketchAuthor');
      const hasUserLinks = pageContent.includes('/user/');
      const hasUserThumb = pageContent.includes('userThumb');
      const hasSketchInfo = pageContent.includes('sketchInfo');
      
      console.error(`🔍 [${sketchId}] ページ内容確認: sketchAuthor=${hasSketchAuthor}, userLinks=${hasUserLinks}, userThumb=${hasUserThumb}, sketchInfo=${hasSketchInfo}`);
      
      // ページの状態をより詳しく確認
      const pageUrl = page.url();
      const isRedirected = pageUrl !== url;
      console.error(`🔍 [${sketchId}] ページURL確認: 元=${url}, 現在=${pageUrl}, リダイレクト=${isRedirected}`);
      
      // スケッチのタイトルとユーザー情報を取得
      console.error(`🔍 [${sketchId}] スケッチ情報抽出開始...`);
      const sketchInfo = await page.evaluate(({ baseUrl, unknownUser, unknownTitle }) => {
        // スケッチのタイトルを取得
        let sketchTitle = '';
        const titleElement = document.querySelector('.sketchTitle');
        if (titleElement) {
          sketchTitle = titleElement.textContent.trim();
          console.log(`✅ スケッチタイトルを発見: "${sketchTitle}"`);
        } else {
          console.log(`⚠️ スケッチタイトルが見つかりませんでした`);
        }
        
        // より広範囲でユーザー情報を探す
        let userElement = null;
        let userName = '';
        let userHref = '';
        
        // 複数のセレクタを試す（優先順位順）
        const selectors = [
          '.sketchAuthor a',           // 最優先：sketchAuthor内のリンク
          '.sketchInfo .userThumbContainer a', // 新しく追加：sketchInfo内のユーザーサムネイル
          '.userThumbContainer a',     // 新しく追加：ユーザーサムネイルコンテナ
          'a[href*="/user/"][data-userid]', // 新しく追加：data-userid属性付きのリンク
          '.sketch-user a',
          '.user-link',
          'a[href*="/user/"]',
          '.author a',
          '.creator a',
          '.user-info a',
          '.profile-link',
          'a[href*="user"]'
        ];
        
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element && element.href && element.textContent.trim()) {
            userElement = element;
            userName = element.textContent.trim();
            userHref = element.href;
            console.log(`✅ セレクタ "${selector}" でユーザー情報を発見:`, { userName, userHref });
            break;
          }
        }
        
        // より広範囲でユーザーリンクを探す（フォールバック）
        if (!userElement) {
          const allLinks = document.querySelectorAll('a[href*="/user/"]');
          console.log(`🔍 フォールバック: ${allLinks.length}件のユーザーリンクを発見`);
          
          // より適切なリンクを優先的に選択
          for (const link of allLinks) {
            const linkText = link.textContent.trim();
            const linkHref = link.href;
            
            // システム生成名や長い文字列を除外
            if (linkText && linkHref && 
                linkText.length < 50 && // 長すぎる名前を除外
                !linkText.match(/^[0-9A-Fa-f]{32,}$/) && // 32文字以上のハッシュを除外
                !linkText.match(/^Q-\d+-\d+$/) && // Q-数字-数字形式を除外
                !linkText.match(/^[0-9]+[a-zA-Z]+[0-9]+$/)) { // 数字+文字+数字形式を除外
              
              userElement = link;
              userName = linkText;
              userHref = linkHref;
              console.log(`✅ フォールバックで適切なユーザー情報を発見:`, { userName, userHref });
              break;
            }
          }
        }
        
        // ページ内のテキストからユーザー名を探す（最後の手段）
        if (!userElement) {
          const pageText = document.body.textContent || '';
          const userMatch = pageText.match(/(?:by|created by|author|creator)\s*:?\s*([a-zA-Z0-9_\-\s]{1,30})/i);
          if (userMatch) {
            const matchedName = userMatch[1].trim();
            // システム生成名を除外
            if (matchedName.length < 50 && 
                !matchedName.match(/^[0-9A-Fa-f]{32,}$/) &&
                !matchedName.match(/^Q-\d+-\d+$/)) {
              userName = matchedName;
              // ユーザー名からURLを推測
              userHref = `${baseUrl}/user/${userName}`;
              console.log(`✅ テキストマッチでユーザー情報を発見:`, { userName, userHref });
            }
          }
        }

        if (!userElement && !userName) {
          console.log(`❌ どのセレクタでもユーザー情報が見つかりませんでした`);
          return { error: 'ユーザー情報が見つかりません' };
        }

        // ユーザーIDをURLから抽出
        const userIdMatch = userHref.match(/\/user\/(\d+)/);
        const userId = userIdMatch ? userIdMatch[1] : null;

        // アイコン画像を取得（複数のセレクタを試す）
        let avatarElement = document.querySelector('.userThumb') ||           // 最優先：userThumbクラス
                           document.querySelector('.userThumbContainer img') || // 新しく追加：userThumbContainer内の画像
                           document.querySelector('img[data-userid]') ||      // 新しく追加：data-userid属性付き画像
                           document.querySelector('.user-avatar img') ||
                           document.querySelector('.avatar img') ||
                           document.querySelector('img[src*="avatar"]') ||
                           document.querySelector('.sketch-user img') ||
                           document.querySelector('.user-info img') ||
                           document.querySelector('.profile img');

        let avatarUrl = null;
        if (avatarElement) {
          avatarUrl = avatarElement.src;
          // 相対URLを絶対URLに変換
          if (avatarUrl.startsWith('/')) {
            avatarUrl = baseUrl + avatarUrl;
          }
          console.log(`✅ アバター画像を発見:`, avatarUrl);
        } else {
          console.log(`⚠️ アバター画像が見つかりませんでした`);
        }

        const result = {
          userId,
          userName: userName || unknownUser,
          userUrl: userHref,
          avatarUrl,
          sketchTitle: sketchTitle || unknownTitle,
          sketchId: window.location.pathname.match(/\/sketch\/(\d+)/)?.[1]
        };
        
        console.log(`🎯 最終的なスケッチ情報:`, result);
        return result;
      }, {
        baseUrl: SCRAPING_CONFIG.baseUrl,
        unknownUser: DEFAULTS.unknownUser,
        unknownTitle: DEFAULTS.unknownTitle
      });
      
      console.error(`✅ [${sketchId}] スケッチ情報抽出完了:`, sketchInfo);
      
      await page.close();
      page = null;
      
      if (sketchInfo.error) {
        throw new Error(sketchInfo.error);
      }

      return sketchInfo;

    } catch (error) {
      console.error(`❌ [${sketchId}] エラー詳細:`, error.message);
      console.error(`📚 [${sketchId}] スタックトレース:`, error.stack);
      return { error: error.message, sketchId };
    } finally {
      if (page && !page.isClosed()) {
        await page.close().catch(() => {});
      }
    }
  }

  async handleChallengeIfNeeded(page, sketchId) {
    const challenge = await this.detectChallenge(page);
    if (!challenge) return;

    if (!this.options.headed) {
      throw new Error(`Cloudflare/Turnstile challenge detected for sketch ${sketchId}. Re-run with --headed --manual-challenge.`);
    }

    if (!this.options.manualChallenge) {
      console.error(`⚠️ [${sketchId}] Cloudflare/Turnstileらしき確認画面を検出しました`);
      return;
    }

    console.error(`\n🧑‍💻 [${sketchId}] Cloudflare/Turnstileらしき確認画面を検出しました`);
    console.error('   開いたブラウザで確認を完了してから、このターミナルで Enter を押してください。');
    console.error('   同じプロファイルを使うため、次回以降は通りやすくなることがあります。');

    await this.waitForEnter();

    const deadline = Date.now() + this.options.challengeTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (!await this.detectChallenge(page)) {
        console.error(`✅ [${sketchId}] 確認画面を抜けたようです。取得を続行します。`);
        return;
      }

      console.error('   まだ確認画面が残っています。完了したらもう一度 Enter を押してください。');
      await this.waitForEnter();
    }

    throw new Error(`Cloudflare/Turnstile challenge was not cleared within ${Math.round(this.options.challengeTimeoutMs / 1000)}s`);
  }

  async detectChallenge(page) {
    try {
      const title = (await page.title()).toLowerCase();
      const url = page.url().toLowerCase();
      const pageSignals = await page.evaluate(() => {
        const text = (document.body?.innerText || '').toLowerCase();
        return {
          hasTurnstile: Boolean(document.querySelector('[name="cf-turnstile-response"], .cf-turnstile, iframe[src*="turnstile"]')),
          hasChallengeForm: Boolean(document.querySelector('#challenge-form, form[action*="challenge"]')),
          text: text.slice(0, 3000)
        };
      });

      return title.includes('just a moment') ||
        title.includes('attention required') ||
        url.includes('/cdn-cgi/challenge-platform/') ||
        pageSignals.hasTurnstile ||
        pageSignals.hasChallengeForm ||
        pageSignals.text.includes('checking if the site connection is secure') ||
        pageSignals.text.includes('verify you are human') ||
        pageSignals.text.includes('turnstile');
    } catch {
      return false;
    }
  }

  async waitForEnter() {
    if (!input.isTTY) {
      console.error('   TTYがないため入力待ちはスキップします。');
      return;
    }

    const rl = createInterface({ input, output });
    try {
      await rl.question('Press Enter to continue...');
    } finally {
      rl.close();
    }
  }

  async waitForExternalBrowserInterval(sketchId) {
    if (!this.lastExternalBrowserOpenAt) {
      return;
    }

    const elapsed = Date.now() - this.lastExternalBrowserOpenAt;
    const remaining = this.options.externalBrowserIntervalMs - elapsed;
    if (remaining <= 0) {
      return;
    }

    console.error(`⏱️ [${sketchId}] 次のブラウザ起動まで${remaining}ms待機します`);
    await new Promise(resolve => setTimeout(resolve, remaining));
  }
}

async function openExternalBrowser(url) {
  const command = getOpenCommand(url);
  console.error(`🌐 OpenProcessingを既定ブラウザで開きます: ${url}`);

  if (!command) {
    console.error(`   ブラウザを自動で開けない環境です。手元のブラウザでこのURLを開いてください: ${url}`);
    return;
  }

  await new Promise((resolveOpen) => {
    const child = spawn(command.command, command.args, {
      detached: true,
      stdio: 'ignore'
    });

    child.on('error', (error) => {
      console.error(`   ブラウザ起動に失敗しました: ${error.message}`);
      console.error(`   手元のブラウザでこのURLを開いてください: ${url}`);
      resolveOpen();
    });

    child.on('spawn', () => {
      child.unref();
      resolveOpen();
    });
  });
}

function getOpenCommand(url) {
  if (process.platform === 'darwin') {
    return { command: 'open', args: [url] };
  }

  if (process.platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'start', '', url] };
  }

  if (process.platform === 'linux') {
    return { command: 'xdg-open', args: [url] };
  }

  return null;
}
