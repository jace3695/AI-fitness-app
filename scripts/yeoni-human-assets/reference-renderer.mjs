// Reference-preserving static renderer. No timing, speech or controller logic.
export function renderReferencePortrait(ctx, base, images, spec, eye, mouth, createCanvas) {
  const [width, height] = spec.size;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(base, 0, 0);
  for (const id of [eye, mouth]) {
    for (const p of spec.parts[id] || []) {
      const [x, y, w, h] = p.rect;
      const layer = createCanvas(w, h), c = layer.getContext('2d');
      c.drawImage(images[p.image], 0, 0);
      c.globalCompositeOperation = 'destination-in';
      for (const axis of ['x', 'y']) {
        const size = axis === 'x' ? w : h;
        const gradient = c.createLinearGradient(0, 0, axis === 'x' ? w : 0, axis === 'y' ? h : 0);
        for (const [at, color] of [[0,'transparent'],[2/size,'transparent'],[p.feather/size,'black'],[1-p.feather/size,'black'],[1-2/size,'transparent'],[1,'transparent']]) gradient.addColorStop(at, color);
        c.fillStyle = gradient; c.fillRect(0, 0, w, h);
      }
      ctx.drawImage(layer, x, y);
    }
  }
}
