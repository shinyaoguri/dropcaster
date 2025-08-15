import { SketchServiceImpl } from '../services/sketchService.js';
import { Router } from './routing/router.js';
import { SketchGalleryView } from '../ui/views/SketchGalleryView.js';
import { SketchPageView } from '../ui/views/SketchPageView.js';
import { Error404View } from '../ui/views/Error404View.js';

export class App {
  private sketchService: SketchServiceImpl;
  private router: Router;

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
    this.router.registerRoute('/:sketchId', (sketchId: string) => {
      const sketch = this.sketchService.getSketchById(sketchId);
      if (sketch) {
        SketchPageView.render(sketch);
      } else {
        Error404View.render();
      }
    });

    // 404エラーページ
    this.router.registerRoute('/404', () => {
      Error404View.render();
    });
  }
}
