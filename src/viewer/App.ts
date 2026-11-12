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
import { parseProject } from './practice/project';
import { t } from './i18n';
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
      const generation = ++this.routeGeneration;
      const status = document.getElementById('dc-practice-status');
      if (status) status.textContent = t('practice.loading');
      try {
        const project = parseProject(await readProject());
        const sketches = await Promise.all(project.show.contentIds.map(async id => {
          const ref = project.content.find(c => c.id === id)!;
          if (ref.kind === 'op') return this.opSource.resolve(ref.ref);
          if (ref.kind === 'gist') return this.gistSource.resolve(ref.ref);
          if (ref.kind === 'builtin') return sampleSketch();
          const local = this.sketchService.getSketchById(ref.ref);
          if (!local) throw new Error('Missing local sketch');
          return local;
        }));
        if (generation !== this.routeGeneration) return;
        if (!sketches.length) throw new Error('No saved sketches');
        this.teardownCurrent();
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
      } catch {
        if (generation !== this.routeGeneration) return;
        if (status?.isConnected) { status.textContent = t('practice.contentMissing'); status.classList.add('is-error'); }
        else SketchErrorView.render('not-found', { detail: t('practice.contentMissing') });
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
      } catch {
        if (generation === this.routeGeneration) { this.venuePage?.destroy(); this.venuePage = null; SketchErrorView.render('not-found', { detail: t('calibration.graphicsError') }); }
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
