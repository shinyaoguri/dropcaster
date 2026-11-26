import { SketchServiceImpl } from './services/sketchService.js';
import { OpenProcessingSource, UnsupportedEngineModeError } from './services/OpenProcessingSource.js';
import { GistSource } from './services/GistSource.js';
import { OpenProcessingRateLimitError } from '../core/modules/op-api-client.js';
import { GistRateLimitError, GistFormatError } from '../core/modules/gist-api-client.js';
import { Router } from './routing/router.js';
import { SketchGalleryView } from './components/SketchGalleryView.js';
import { OpIdEntryView, type SketchRef } from './components/OpIdEntryView.js';
import { SketchPageController } from './components/SketchPageController.js';
import { SlideshowController } from './components/SlideshowController.js';
import { Error404View } from './components/Error404View.js';
import { SketchErrorView } from './components/SketchErrorView.js';
import { API_CONFIG, GIST_CONFIG } from '../core/modules/constants.js';
import { readProject } from './practice/projectStore';
import { readSnapshot } from './practice/snapshotStore';
import { parseProject, ProjectFormatError } from './practice/project';
import { t, type MessageKey } from './i18n';
import type { VenueCalibrationPage } from './venue/VenueCalibrationPage';
import { sampleSketch } from './practice/sampleSketch';

export class App {
  private sketchService: SketchServiceImpl;
  private opSource: OpenProcessingSource;
  private gistSource: GistSource;
  private router: Router;
  private sketchPageController: SketchPageController | null = null;
  private slideshowController: SlideshowController | null = null;
  private routeGeneration = 0;
  private venuePage: VenueCalibrationPage | null = null;

  constructor() {
    this.sketchService = new SketchServiceImpl();
    this.opSource = new OpenProcessingSource();
    this.gistSource = new GistSource();
    this.router = new Router(this.sketchService);
    this.setupRoutes();
  }

  async initialize(): Promise<void> {
    await this.sketchService.loadSketches();
    this.router.handleRoute();
  }

  /**
   * ルート遷移前に、前のページが残したものを全て片付ける。
   * ここを通さないルートがあると、リスナ（beforeunload / keydown）や
   * interval（スライドショー自動進行、レート制限カウントダウン）、
   * MediaStream が前のページから残留する。
   */
  private teardownCurrent(): void {
    this.routeGeneration++;
    this.venuePage?.destroy(); this.venuePage = null;
    if (this.sketchPageController) {
      this.sketchPageController.destroy();
      this.sketchPageController = null;
    }
    if (this.slideshowController) {
      this.slideshowController.destroy();
      this.slideshowController = null;
    }
    SketchErrorView.cancelCountdown();
  }

  private setupRoutes(): void {
    // ホームページ: catalog の有無で顔を切り替える。
    //   - catalog 空 → OP ID 入力をメインに据えたホスト版風 hero
    //   - catalog あり → 既存のギャラリー + 上部に小さな OP ID 入力バー
    const goSketch = (ref: SketchRef) => this.router.navigate(`/${ref.source}/${ref.id}`);
    this.router.registerRoute('/', () => {
      this.teardownCurrent();
      const sketches = this.sketchService.getAllSketches();
      if (sketches.length === 0) {
        OpIdEntryView.renderHero(goSketch);
      } else {
        SketchGalleryView.render(sketches, goSketch);
      }
    });

    // 個別スケッチページ（パラメータ付き）
    this.router.registerRoute('/:sketchId', async (sketchId: string) => {
      const sketch = this.sketchService.getSketchById(sketchId);
      if (sketch) {
        this.teardownCurrent();

        // 新しいコントローラーを作成してスケッチを表示
        this.sketchPageController = new SketchPageController();
        await this.sketchPageController.renderSketch(sketch);
      } else {
        this.teardownCurrent();
        Error404View.render();
      }
    });

    // OpenProcessing 経路: /op/<id> または /?op=<id>
    this.router.registerRoute('/op/:id', async (opId: string) => {
      this.teardownCurrent();
      const generation = this.routeGeneration;

      try {
        const sketch = await this.opSource.resolve(opId);
        if (generation !== this.routeGeneration) return;
        this.sketchPageController = new SketchPageController();
        await this.sketchPageController.renderSketch(sketch);
      } catch (err) {
        if (generation !== this.routeGeneration) return;
        const sketchUrl = `${API_CONFIG.baseUrl}/sketch/${opId}`;
        if (err instanceof OpenProcessingRateLimitError) {
          console.warn(err.message);
          SketchErrorView.render('rate-limit', {
            retryAfterMs: err.retryAfterMs,
            onRetry: () => this.router.navigate(`/op/${opId}`),
          });
        } else if (err instanceof UnsupportedEngineModeError) {
          console.warn(err.message);
          SketchErrorView.render('unsupported-mode', { mode: err.mode, sketchUrl });
        } else {
          console.error('OpenProcessing sketch の取得に失敗:', err);
          SketchErrorView.render('not-found', {
            sketchUrl,
            detail: err instanceof Error ? err.message : undefined,
          });
        }
      }
    });

    // Gist 経路: /gist/<id> または /?gist=<id>
    this.router.registerRoute('/gist/:id', async (gistId: string) => {
      this.teardownCurrent();
      const generation = this.routeGeneration;

      const gistUrl = `${GIST_CONFIG.baseUrl}/${gistId}`;
      try {
        const sketch = await this.gistSource.resolve(gistId);
        if (generation !== this.routeGeneration) return;
        this.sketchPageController = new SketchPageController();
        await this.sketchPageController.renderSketch(sketch);
      } catch (err) {
        if (generation !== this.routeGeneration) return;
        if (err instanceof GistRateLimitError) {
          console.warn(err.message);
          SketchErrorView.render('rate-limit', {
            retryAfterMs: err.retryAfterMs,
            source: 'gist',
            onRetry: () => this.router.navigate(`/gist/${gistId}`),
          });
        } else if (err instanceof GistFormatError) {
          // 取得はできたが index.html が無い等、スケッチとして実行できない Gist
          console.warn(err.message);
          SketchErrorView.render('invalid-format', {
            sketchUrl: gistUrl,
            source: 'gist',
            detail: err.message,
          });
        } else {
          console.error('Gist の取得に失敗:', err);
          SketchErrorView.render('not-found', {
            sketchUrl: gistUrl,
            source: 'gist',
            detail: err instanceof Error ? err.message : undefined,
          });
        }
      }
    });

    // Resolve every saved reference before replacing the current working view.
    this.router.registerRoute('/project', async () => {
      let generation = ++this.routeGeneration;
      const status = document.getElementById('dc-practice-status');
      if (status) status.textContent = t('practice.loading');
      // 失敗した段階で案内を変える (#198)。下書きを読めないことと、作品を取得できないことは対処が違う。
      let failure: MessageKey = 'practice.draftUnreadable';
      try {
        const stored = await readProject();
        if (!stored) { failure = 'practice.draftMissing'; throw new Error('No project draft is saved'); }
        let project;
        try { project = parseProject(stored); } catch (error) {
          // 作品が多すぎる下書きは、再読み込みしても開けない。読み出しの失敗とは別の案内にする (#173)。
          if (error instanceof ProjectFormatError && error.message === 'contentLimit') failure = 'practice.draftTooLarge';
          throw error;
        }
        failure = 'practice.contentMissing';
        const refs = new Map(project.content.map(c => [c.id, c])); // 作品数の 2 乗にならないよう引く (#173)
        const sketches = await Promise.all(project.show.contentIds.map(async id => {
          const ref = refs.get(id)!;
          if (ref.kind === 'op' || ref.kind === 'gist') {
            const source = ref.kind === 'op' ? this.opSource : this.gistSource;
            // 固定した作品は、このブラウザにある固定時のコードで開き、取得元へ問い合わせない (#197)。
            // 無ければ (受け取ったプロジェクト・消えた記録) 最新を開き、違いはプロジェクトパネルが知らせる。
            if (ref.revisionPinned) {
              const pinned = await readSnapshot(ref.hash).catch(error => { console.warn('Pinned sketch code could not be read', error); return undefined; });
              if (pinned && pinned.payload.kind === ref.kind && pinned.payload.ref.toLowerCase() === ref.ref.toLowerCase()) return source.fromSnapshot(pinned);
            }
            return source.resolve(ref.ref);
          }
          if (ref.kind === 'builtin') return sampleSketch();
          const local = this.sketchService.getSketchById(ref.ref);
          if (!local) throw new Error('Missing local sketch');
          return local;
        }));
        if (generation !== this.routeGeneration) return;
        if (!sketches.length) throw new Error('No saved sketches');
        failure = 'practice.openError';
        // teardownCurrent は世代を進める。ここから先の失敗も、この遷移のものとして案内する。
        this.teardownCurrent(); generation = this.routeGeneration;
        if (sketches.length === 1) {
          const controller = new SketchPageController();
          this.sketchPageController = controller;
          await controller.renderSketch(sketches[0]);
          if (this.sketchPageController === controller) await controller.openProject(project);
        } else {
          this.slideshowController = new SlideshowController();
          this.slideshowController.start(sketches, project.show);
          await this.slideshowController.openProject(project);
        }
      } catch (error) {
        if (generation !== this.routeGeneration) return;
        console.error(`Saved project could not be opened (${failure}):`, error);
        const opening = failure === 'practice.openError';
        // 作業中の画面を残したまま失敗したときは、その画面の状態欄に出す。表示の規則 (平常時は読み上げ専用、
        // エラーは見せる、言語の切り替えで訳し直す) は MappingWorkspace が持つので、そこを通す。
        if (!opening && (this.sketchPageController?.reportMappingError(failure) || this.slideshowController?.reportMappingError(failure))) return;
        this.teardownCurrent(); // 生きている画面・開きかけの画面を片付けてから案内に差し替える
        SketchErrorView.render('open-failed', { failure: { title: 'practice.openErrorTitle', message: failure,
          reload: opening || failure === 'practice.draftUnreadable' } });
      }
    });

    const openSampleMapping = async () => {
      this.teardownCurrent();
      const controller = new SketchPageController();
      this.sketchPageController = controller;
      await controller.renderSketch(sampleSketch());
      if (this.sketchPageController === controller) await controller.startMapping();
    };
    this.router.registerRoute('/venue', async () => {
      this.teardownCurrent(); const generation = this.routeGeneration;
      try {
        const { VenueCalibrationPage } = await import('./venue/VenueCalibrationPage');
        if (generation !== this.routeGeneration) return;
        const page = new VenueCalibrationPage(); this.venuePage = page;
        await page.initialize();
      } catch (error) {
        if (generation !== this.routeGeneration) return;
        // ここへ来るのは画面のコードを取得できないときと、3D を作り始める前の失敗 (#198)。
        // WebGL が使えないことは VenueCalibrationPage が自分の画面で案内する。
        console.error('Venue setup could not be opened:', error);
        this.venuePage?.destroy(); this.venuePage = null;
        SketchErrorView.render('open-failed', { failure: { title: 'calibration.openErrorTitle', message: 'calibration.openError', reload: true } });
      }
    });
    this.router.registerRoute('/mapping', openSampleMapping);
    this.router.registerRoute('/practice', openSampleMapping); // Existing bookmarks remain valid.

    // スライドショーページ
    this.router.registerRoute('/slideshow', () => {
      this.teardownCurrent();

      // スライドショーを開始
      const sketches = this.sketchService.getAllSketches();
      this.slideshowController = new SlideshowController();
      this.slideshowController.start(sketches);
    });

    // 404エラーページ
    this.router.registerRoute('/404', () => {
      this.teardownCurrent();
      Error404View.render();
    });
  }
}
