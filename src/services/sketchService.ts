import type { Sketch, SketchService } from '../types/sketch.js';

export class SketchServiceImpl implements SketchService {
  private sketches: Sketch[] = [];
  private isInitialized = false;

  async loadSketches(): Promise<Sketch[]> {
    try {
      const response = await fetch('/sketches.json');
      this.sketches = await response.json();
      this.isInitialized = true;
      return this.sketches;
    } catch (error) {
      console.error('Failed to load sketches:', error);
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
