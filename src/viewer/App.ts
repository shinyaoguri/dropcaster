import { SketchServiceImpl } from './services/sketchService.js';
import { OpenProcessingSource, UnsupportedEngineModeError } from './services/OpenProcessingSource.js';
import { Router } from './routing/router.js';
import { SketchGalleryView } from './components/SketchGalleryView.js';
import { SketchPageController } from './components/SketchPageController.js';
import { SlideshowController } from './components/SlideshowController.js';
import { Error404View } from './components/Error404View.js';

export class App {
  private sketchService: SketchServiceImpl;
  private opSource: OpenProcessingSource;
  private router: Router;
  private sketchPageController: SketchPageController | null = null;
  private slideshowController: SlideshowController | null = null;

  constructor() {
    this.sketchService = new SketchServiceImpl();
    this.opSource = new OpenProcessingSource();
    this.router = new Router(this.sketchService);
    this.setupRoutes();
  }

  async initialize(): Promise<void> {
    await this.sketchService.loadSketches();
    this.router.handleRoute();
  }

  private setupRoutes(): void {
    // ホームページ（ギャラリー）
    this.router.registerRoute('/', () => {
      const sketches = this.sketchService.getAllSketches();
      SketchGalleryView.render(sketches);
    });

    // 個別スケッチページ（パラメータ付き）
    this.router.registerRoute('/:sketchId', async (sketchId: string) => {
      const sketch = this.sketchService.getSketchById(sketchId);
      if (sketch) {
        // 既存のコントローラーを破棄
        if (this.sketchPageController) {
          this.sketchPageController.setInternalNavigation(true);
          this.sketchPageController.destroy();
          this.sketchPageController = null;
        }

        // 新しいコントローラーを作成してスケッチを表示
        this.sketchPageController = new SketchPageController();
        await this.sketchPageController.renderSketch(sketch);
      } else {
        Error404View.render();
      }
    });

    // OpenProcessing 経路: /op/<id> または /?op=<id>
    this.router.registerRoute('/op/:id', async (opId: string) => {
      // 既存のコントローラーを破棄
      if (this.sketchPageController) {
        this.sketchPageController.setInternalNavigation(true);
        this.sketchPageController.destroy();
        this.sketchPageController = null;
      }
      try {
        const sketch = await this.opSource.resolve(opId);
        this.sketchPageController = new SketchPageController();
        await this.sketchPageController.renderSketch(sketch);
      } catch (err) {
        if (err instanceof UnsupportedEngineModeError) {
          console.warn(err.message);
        } else {
          console.error('OpenProcessing sketch の取得に失敗:', err);
        }
        Error404View.render();
      }
    });

    // スライドショーページ
    this.router.registerRoute('/slideshow', () => {
      // 既存のコントローラーを破棄
      if (this.sketchPageController) {
        this.sketchPageController.destroy();
        this.sketchPageController = null;
      }
      if (this.slideshowController) {
        this.slideshowController.destroy();
      }
      
      // スライドショーを開始
      const sketches = this.sketchService.getAllSketches();
      this.slideshowController = new SlideshowController();
      this.slideshowController.start(sketches);
    });

    // 404エラーページ
    this.router.registerRoute('/404', () => {
      Error404View.render();
    });
  }
}
