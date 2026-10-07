// Static review only. A shared coordinate system keeps all face patches on the head.
export function renderHumanRig(ctx,images,spec,eye='open',mouth='closed',createCanvas) {
  const [w,h]=spec.size;ctx.clearRect(0,0,w,h);
  for(const id of ['body','head']) { const p=spec.layers[id];ctx.drawImage(images[p.image],p.rect[0],p.rect[1]); }
  for(const id of [eye,mouth])for(const p of spec.faceParts[id]||[]){
    const[x,y,width,height]=p.rect,layer=createCanvas(width,height),c=layer.getContext('2d');
    c.drawImage(images[p.image],0,0);c.globalCompositeOperation='destination-in';
    for(const vertical of [false,true]){
      const n=vertical?height:width,g=c.createLinearGradient(0,0,vertical?0:width,vertical?height:0);
      for(const[t,color]of [[0,'transparent'],[2/n,'transparent'],[p.feather/n,'black'],[1-p.feather/n,'black'],[1-2/n,'transparent'],[1,'transparent']])g.addColorStop(t,color);
      c.fillStyle=g;c.fillRect(0,0,width,height);
    }
    ctx.drawImage(layer,x,y);
  }
}
