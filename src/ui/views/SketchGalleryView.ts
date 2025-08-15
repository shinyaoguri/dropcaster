import type { Sketch } from '../../types/sketch.js';
import { SketchCard } from '../components/SketchCard.js';

export class SketchGalleryView {
  static render(sketches: Sketch[]): void {
    const app = document.querySelector<HTMLDivElement>('#app')!;
    
    app.innerHTML = `
      <div class="container">
        <header class="header">
          <h1>Sketch Gallery</h1>
        </header>
        
        <div class="gallery-grid">
          ${sketches.map(sketch => SketchCard.render(sketch)).join('')}
        </div>
      </div>
    `;
  }
}
