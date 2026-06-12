export interface OpSketchLibrary {
  libraryID?: number | string;
  url: string;
}

export interface OpSketchMeta {
  visualID?: number | string;
  visualId?: number | string;
  title?: string;
  description?: string;
  instructions?: string;
  tags?: string[];
  license?: string;
  mode?: string;
  engineURL?: string;
  libraries?: OpSketchLibrary[];
  fileBase?: string;
  userID?: number | string;
  userId?: number | string;
  username?: string;
  user?: { userID?: number | string; username?: string; fullname?: string };
  createdOn?: string;
  updatedOn?: string;
  [k: string]: unknown;
}

export interface OpCodeTab {
  codeID?: number;
  visualID?: number;
  orderID?: number;
  code?: string;
  title?: string;
  [k: string]: unknown;
}

export interface AssembleOpSketchHtmlParams {
  meta: OpSketchMeta;
  codeTabs: OpCodeTab[];
  options?: {
    assetProxyBaseUrl?: string;
    injectCorsShim?: boolean;
    injectErrorShim?: boolean;
  };
}

export function assembleOpSketchHtml(params: AssembleOpSketchHtmlParams): string;
export function assembleHtmlModeOpSketchHtml(params: {
  meta: OpSketchMeta;
  codeTabs: OpCodeTab[];
  options?: { assetProxyBaseUrl?: string };
}): string;
export function rewriteAssetUrls(text: string, assetProxyBaseUrl?: string): string;
export function sortAndJoinCode(codeTabs: OpCodeTab[]): string;
export function hasExternalDeckardAsset(codeTabs: OpCodeTab[]): boolean;
export function assembleLocalOpSketchHtml(params: {
  engineURL: string;
  libraries?: OpSketchLibrary[];
  scriptFiles: string[];
}): string;
