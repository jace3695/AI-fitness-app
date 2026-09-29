import type { Viseme } from './lip-sync';

/** Small vector mouth on the blank-mouth PoC atlas; nose/whiskers are untouched. */
export function drawCatMouth(ctx: CanvasRenderingContext2D, viseme: Viseme) {
  ctx.save(); ctx.translate(169, 187);
  ctx.strokeStyle = '#47208b'; ctx.fillStyle = '#54266f'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
  if (viseme === 'rest' || viseme === 'closed') {
    ctx.beginPath(); ctx.moveTo(-15, 0); ctx.bezierCurveTo(-12, 7, -3, 7, 0, 0);
    ctx.bezierCurveTo(3, 7, 12, 7, 15, 0); ctx.stroke();
  } else {
    // i: wide/thin; e: wide/open. u: narrow/pursed; o: round/open.
    const [width, height] = { small: [8, 5], a: [12, 13], i: [17, 4], u: [5, 7], e: [16, 9], o: [9, 11] }[viseme];
    ctx.beginPath(); ctx.ellipse(0, 5, width, height, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.save(); ctx.clip(); ctx.fillStyle = '#e4a4cc'; ctx.beginPath();
    ctx.ellipse(1, height + 3, width * .75, height * .45, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  ctx.restore();
}
