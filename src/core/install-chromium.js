// Playwright の Chromium をインストールする共通ヘルパー。
// postinstall（DROPCASTER_INSTALL_BROWSER=1 時）と `dropcaster doctor --install` から使う。
import { spawnSync } from 'child_process';
import { t } from '../cli/i18n/index.js';

// クロスプラットフォームのためシェル経由。固定コマンドなので安全。
export function installChromium() {
  try {
    const result = spawnSync('npx playwright install chromium', {
      stdio: 'inherit',
      shell: true
    });
    if (result.error || result.status !== 0) {
      console.warn(t('postinstall.chromiumFailed'));
      console.warn(t('postinstall.chromiumManual'));
      return false;
    }
    return true;
  } catch (error) {
    console.warn(t('postinstall.chromiumException', { error: error.message }));
    return false;
  }
}
