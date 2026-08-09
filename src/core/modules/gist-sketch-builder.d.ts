import type { GistData } from './gist-api-client.js';

export function assembleGistSketchHtml(params: { gist: GistData }): string;
export function sketchFiles(gist: GistData): Map<string, string>;
export function resolveGistTitle(gist: GistData): string;
export function isCanvastageGist(gist: GistData): boolean;
