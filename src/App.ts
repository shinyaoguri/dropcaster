import { SketchServiceImpl } from './services/sketchService.js';
import { Router } from './routing/router.js';
import { SketchGalleryView } from './components/SketchGalleryView.js';
import { SketchPageController } from './components/SketchPageController.js';
import { SlideshowController } from './components/SlideshowController.js';
import { Error404View } from './components/Error404View.js';

export class App {
  private sketchService: SketchServiceImpl;
  private router: Router;
  private sketchPageController: SketchPageController | null = null;
  private slideshowController: SlideshowController | null = null;

  constructor() {
    this.sketchService = new SketchServiceImpl();
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
          this.sketchPageController.destroy();
        }
        
        // 新しいコントローラーを作成してスケッチを表示
        this.sketchPageController = new SketchPageController();
        await this.sketchPageController.renderSketch(sketch);
      } else {
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
