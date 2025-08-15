export interface RouteHandler {
  (params?: any): void;
}

export class Router {
  private routes: Map<string, RouteHandler> = new Map();
  private sketchService: any;

  constructor(sketchService: any) {
    this.sketchService = sketchService;
    this.setupEventListeners();
  }

  registerRoute(path: string, handler: RouteHandler): void {
    this.routes.set(path, handler);
  }

  navigate(path: string): void {
    window.history.pushState({}, '', path);
    this.handleRoute();
  }

  handleRoute(): void {
    if (!this.sketchService.isReady()) {
      return;
    }

    const path = window.location.pathname;
    
    if (path === '/') {
      const handler = this.routes.get('/');
      if (handler) handler();
    } else {
      // パラメータ付きルートの処理
      const pathSegments = path.split('/').filter(segment => segment);
      if (pathSegments.length === 1) {
        const sketchId = pathSegments[0];
        const handler = this.routes.get('/:sketchId');
        if (handler) handler(sketchId);
      } else {
        const handler = this.routes.get('/404');
        if (handler) handler();
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
        this.navigate(url.pathname);
      }
    });
  }
}
