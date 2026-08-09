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

    // 外部ソース経路を最優先で拾う:
    //   /op/<id>   /?op=<id>     OpenProcessing (id は数字)
    //   /gist/<id> /?gist=<id>   公開 Gist (id は 20 桁以上の hex)
    // クエリベースは任意のパスで効くが、典型はホーム。
    const opId = pickOpId(path, window.location.search);
    if (opId) {
      const handler = this.routes.get('/op/:id');
      if (handler) { handler(opId); return; }
    }

    const gistId = pickGistId(path, window.location.search);
    if (gistId) {
      const handler = this.routes.get('/gist/:id');
      if (handler) { handler(gistId); return; }
    }

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
        // search も含めて navigate (?op=<id> リンクで OP 経路に入れるように)
        this.navigate(stripBasePath(url.pathname) + url.search);
      }
    });
  }
}

/** path と search から OP の id を拾う。なければ null。 */
function pickOpId(path: string, search: string): string | null {
  // path: /op/<id> 形式 (id は数字のみ)
  const pathMatch = path.match(/^\/op\/(\d+)\/?$/);
  if (pathMatch) return pathMatch[1];

  // ?op=<id> または ?op=sketch<id>
  try {
    const params = new URLSearchParams(search);
    const raw = params.get('op');
    if (raw) {
      const id = raw.replace(/^sketch/i, '');
      if (/^\d+$/.test(id)) return id;
    }
  } catch { /* ignore */ }
  return null;
}

/** path と search から Gist の id を拾う。なければ null。 */
function pickGistId(path: string, search: string): string | null {
  // path: /gist/<id> 形式 (id は 20 桁以上の hex。OP の数値 id とは空間が重ならない)
  const pathMatch = path.match(/^\/gist\/([0-9a-f]{20,})\/?$/i);
  if (pathMatch) return pathMatch[1].toLowerCase();

  // ?gist=<id>
  try {
    const params = new URLSearchParams(search);
    const raw = (params.get('gist') ?? '').trim();
    if (/^[0-9a-f]{20,}$/i.test(raw)) return raw.toLowerCase();
  } catch { /* ignore */ }
  return null;
}
