import axios from 'axios';
import { promises as fs } from 'fs';
import { SCRAPING_CONFIG, CONTENT_TYPE_EXTENSIONS, DEFAULTS } from './config.js';

export class AvatarManager {
  constructor() {
    this.downloadedAvatars = new Map(); // ユーザーID -> アバターファイルパスのマップ
  }

  async downloadAvatar(avatarUrl, userId, sketchId) {
    if (!avatarUrl) {
      console.error('⚠️ アイコンURLが見つかりません');
      return null;
    }

    // ユーザーIDがない場合は、スケッチIDベースで管理
    const avatarKey = userId || `sketch_${sketchId}`;
    
    // 既にダウンロード済みの場合は、そのパスを返す
    if (this.downloadedAvatars.has(avatarKey)) {
      const existingPath = this.downloadedAvatars.get(avatarKey);
      console.error(`♻️ アバター画像を再利用: ${avatarKey} -> ${existingPath}`);
      return existingPath;
    }

    try {
      // public/avatarsディレクトリを作成
      const avatarsDir = SCRAPING_CONFIG.avatarDirectory;
      try {
        await fs.mkdir(avatarsDir, { recursive: true });
        console.error(`✅ アバターディレクトリを作成/確認: ${avatarsDir}`);
      } catch (error) {
        console.error(`⚠️ アバターディレクトリの作成に失敗:`, error.message);
      }

      const response = await axios.get(avatarUrl, {
        responseType: 'arraybuffer',
        timeout: SCRAPING_CONFIG.avatarDownloadTimeout,
        headers: {
          'User-Agent': SCRAPING_CONFIG.userAgent
        }
      });

      // ファイル拡張子を判定
      const contentType = response.headers['content-type'];
      let extension = CONTENT_TYPE_EXTENSIONS[contentType] || DEFAULTS.extension;

      // ファイル名を生成（ユーザーIDがある場合はユーザーIDベース、ない場合はスケッチIDベース）
      let filename;
      if (userId) {
        filename = `user${userId}${extension}`;
      } else {
        filename = `sketch${sketchId}${extension}`;
      }
      
      const filepath = `${avatarsDir}/${filename}`;
      
      await fs.writeFile(filepath, response.data);
      
      console.error(`✅ アイコンをダウンロード: ${filepath}`);
      
      // 相対パスを生成
      const relativePath = `../avatars/${filename}`;
      
      // ダウンロード済みマップに保存
      this.downloadedAvatars.set(avatarKey, relativePath);
      
      return relativePath;
      
    } catch (error) {
      console.error('❌ アイコンダウンロードエラー:', error.message);
      return null;
    }
  }

  // ダウンロード統計を取得
  getDownloadStats() {
    return {
      totalDownloaded: this.downloadedAvatars.size,
      downloadedAvatars: Array.from(this.downloadedAvatars.entries())
    };
  }

  // 特定のアバターが既にダウンロード済みかチェック
  isAlreadyDownloaded(avatarKey) {
    return this.downloadedAvatars.has(avatarKey);
  }

  // 既存のアバターパスを取得
  getExistingAvatarPath(avatarKey) {
    return this.downloadedAvatars.get(avatarKey);
  }
}
