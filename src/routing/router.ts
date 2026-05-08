import type { SketchService } from '../types/sketch.js';
import { routeHref, stripBasePath } from '../utils/paths.js';

export interface RouteHandler {
  (params: string): void | Promise<void>;
}

export class Router {
  private routes: Map<string, RouteHandler> = new Map();
  private sketchService: SketchService;

  constructor(sketchService: SketchService) {
    this.sketchService = sketchService;
    this.setupEventListeners();
  }

  registerRoute(path: string, handler: RouteHandler): void {
    this.routes.set(path, handler);
  }

  navigate(path: string): void {
    window.history.pushState({}, '', routeHref(path));
    this.handleRoute();
  }

  handleRoute(): void {
    if (!this.sketchService.isReady()) {
      return;
    }

    const path = stripBasePath(window.location.pathname);
    
    // 完全一致のルートをまずチェック
    const exactHandler = this.routes.get(path);
    if (exactHandler) {
      exactHandler('');
      return;
    }
    
    // ホームページ
    if (path === '/') {
      const handler = this.routes.get('/');
      if (handler) handler('');
    } else {
      // パラメータ付きルートの処理
      const pathSegments = path.split('/').filter(segment => segment);
      if (pathSegments.length === 1 && pathSegments[0] !== 'slideshow') {
        const sketchId = decodeURIComponent(pathSegments[0]);
        const handler = this.routes.get('/:sketchId');
        if (handler) handler(sketchId);
      } else if (path !== '/slideshow') {
        const handler = this.routes.get('/404');
        if (handler) handler('');
      }
    }
  }

  private setupEventListeners(): void {
    window.addEventListener('popstate', () => this.handleRoute());

    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const link = target.closest('a');
      
      if (link && link.href.startsWith(window.location.origin) && link.target !== '_blank') {
        e.preventDefault();
        const url = new URL(link.href);
        this.navigate(stripBasePath(url.pathname));
      }
    });
  }
}
