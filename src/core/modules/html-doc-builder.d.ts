export function assembleDocumentFromFiles(params: {
  files: Map<string, string>;
  baseHref?: string;
}): string;
export function findIndexFileName(files: Map<string, unknown>): string | null;
export function embeddedScriptAttrs(code: string, fileName: string): string;
export function escapeAttr(s: unknown): string;
