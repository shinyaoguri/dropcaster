import type { OpSketchMeta, OpCodeTab } from './op-sketch-builder.js';

export interface OpenProcessingApiClientOptions {
  apiToken?: string;
  apiRequestIntervalMs?: number;
}

export interface OpSketchUserInfo {
  userId: string;
  userName: string;
  userUrl: string;
  sketchTitle: string;
  sketchDescription: string;
  sketchId: string;
  sketchUrl: string;
}

export class OpenProcessingApiClient {
  constructor(options?: OpenProcessingApiClientOptions);
  getSketch(sketchId: string | number): Promise<OpSketchMeta>;
  getSketchCode(sketchId: string | number): Promise<OpCodeTab[]>;
  getSketchUserInfo(sketchId: string | number): Promise<OpSketchUserInfo | { error: string; sketchId: string }>;
  getUser(userId: string | number): Promise<Record<string, unknown> | null>;
}

export class OpenProcessingRateLimitError extends Error {
  readonly name: 'OpenProcessingRateLimitError';
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number, message?: string);
}

export function fetchUserDataForSketches(
  sketchIds: Array<string | number>,
  options?: OpenProcessingApiClientOptions & {
    onProgress?: (info: { index: number; total: number; sketchId: string | number; result: unknown }) => void;
  }
): Promise<Array<OpSketchUserInfo | { error: string; sketchId: string }>>;
