import type { Sketch } from '../types/sketch';
import { t } from '../i18n';

/** Bundled, deterministic source: practice works without an external sketch service. */
export function sampleSketch(): Sketch {
  return { id: 'builtin-checkerboard', title: t('practice.sampleSource'), description: '', path: '', type: 'html',
    tags: [], interactiveElements: [], lastModified: '1', srcdoc: `<!doctype html><html><body><canvas width="1920" height="1080"></canvas><script>
      const canvas = document.querySelector('canvas'), ctx = canvas.getContext('2d');
      function draw() {
        const colors = ['#ef6351','#f9c846','#4cb7a5','#4389d3','#9775c9','#ededed'];
        colors.forEach((color, i) => { ctx.fillStyle = color; ctx.fillRect(i*320, 0, 320, 1080); });
        ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 3;
        for (let x=0;x<=1920;x+=120) { ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,1080);ctx.stroke(); }
        for (let y=0;y<=1080;y+=120) { ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1920,y);ctx.stroke(); }
        ctx.fillStyle = '#151515';ctx.font = 'bold 82px sans-serif';ctx.fillText('dropcaster',70,120);
        ctx.font = '48px sans-serif';ctx.fillText('TOP LEFT',70,1010);ctx.fillText('RIGHT →',1560,1010);
        ctx.strokeStyle = '#fff';ctx.lineWidth=12;ctx.strokeRect(12,12,1896,1056);
      }
      // The calibration image is static. Redraw occasionally for newly attached
      // captures, without uploading an unchanged 1080p texture on every frame.
      let last = 0;
      function tick(time) { if (time-last > 1000) { draw(); last=time; } requestAnimationFrame(tick); }
      draw(); requestAnimationFrame(tick);
    </script></body></html>` };
}
