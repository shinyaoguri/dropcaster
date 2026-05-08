const RAW_BASE_URL = import.meta.env.BASE_URL || '/';

function ensureTrailingSlash(path: string): string {
  return path.endsWith('/') ? path : `${path}/`;
}

export function getBasePath(): string {
  const base = ensureTrailingSlash(RAW_BASE_URL);
  return base.startsWith('/') ? base : `/${base}`;
}

export function stripBasePath(pathname: string): string {
  const base = getBasePath();
  const baseWithoutSlash = base.slice(0, -1);

  if (base === '/') {
    return pathname || '/';
  }

  if (pathname === baseWithoutSlash) {
    return '/';
  }

  if (pathname.startsWith(base)) {
    return `/${pathname.slice(base.length)}`;
  }

  return pathname || '/';
}

export function routeHref(route: string): string {
  const base = getBasePath();
  const cleanRoute = route.replace(/^\/+/, '');
  return cleanRoute ? `${base}${cleanRoute}` : base;
}

export function publicAssetPath(path: string): string {
  if (!path) {
    return routeHref('');
  }

  if (/^(https?:|data:image\/|blob:)/i.test(path)) {
    return path;
  }

  const cleanPath = path
    .replace(/^\.\.\//, '')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');

  return `${getBasePath()}${cleanPath}`;
}
