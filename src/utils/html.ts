export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function safeUrl(value: unknown, fallback = '#'): string {
  const rawValue = String(value ?? '').trim();
  if (!rawValue) {
    return fallback;
  }

  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'https://example.invalid';
    const url = new URL(rawValue, base);
    const allowedProtocols = new Set(['http:', 'https:', 'blob:']);

    if (allowedProtocols.has(url.protocol) || url.href.startsWith('data:image/')) {
      return url.href;
    }
  } catch {
    return fallback;
  }

  return fallback;
}
