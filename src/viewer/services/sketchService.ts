import type { Sketch, SketchService } from '../types/sketch.js';
import { publicAssetPath } from '../utils/paths.js';

export class SketchServiceImpl implements SketchService {
  private sketches: Sketch[] = [];
  private isInitialized = false;

  async loadSketches(): Promise<Sketch[]> {
    try {
      const response = await fetch(publicAssetPath('sketches.json'), {
        cache: 'no-cache'
      });

      // ホスト版 (apps/web) のように sketches.json を同梱しない場合、404 か
      // SPA fallback の text/html が返るので、どちらも「catalog 無し」として
      // 静かに扱う (error ではなく info で出して emptyState を選ばせる)。
      if (response.status === 404) {
        console.info('No sketches.json found — running in empty-catalog mode');
        this.sketches = [];
        this.isInitialized = true;
        return [];
      }
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !contentType.toLowerCase().includes('json')) {
        console.info('sketches.json missing or not JSON — running in empty-catalog mode');
        this.sketches = [];
        this.isInitialized = true;
        return [];
      }

      const sketches = await response.json();
      if (!Array.isArray(sketches)) {
        throw new Error('sketches.json must contain an array');
      }

      this.sketches = sketches;
      this.isInitialized = true;
      return this.sketches;
    } catch (error) {
      console.error('Failed to load sketches:', error);
      this.sketches = [];
      this.isInitialized = true;
      return [];
    }
  }

  getSketchById(id: string): Sketch | undefined {
    return this.sketches.find(s => s.id === id);
  }

  getAllSketches(): Sketch[] {
    return [...this.sketches];
  }

  isReady(): boolean {
    return this.isInitialized;
  }
}
