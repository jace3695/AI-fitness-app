import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
const pack=JSON.parse(readFileSync('content/drawing/foundations-v1.json','utf8'));
const lesson=pack.lessons[0];
let svg='<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="645" viewBox="0 0 2400 860"><rect width="2400" height="860" fill="white"/><defs><marker id="arrow" markerWidth="5" markerHeight="5" refX="3.5" refY="2.5" orient="auto"><path d="M0 0 L5 2.5 L0 5Z" fill="#bd530c"/></marker></defs>';
lesson.examples.forEach((example,row)=>{
 const seen=new Set();
 lesson.steps.forEach((step,index)=>{
  svg+=`<g transform="translate(${index*400},${row*430})"><text x="18" y="25" font-size="18">${example.id} / step ${index+1}</text>`;
  for(const line of example.lines){
   const active=step.lines.includes(line.id);
   if(step.action!=='look'&&(seen.has(line.id)||active))svg+=`<path d="${line.d}" fill="${line.fill==='ink'?(active?'#7750c4':'#c5c1cf'):'none'}" stroke="${line.fill==='ink'?'none':active?'#7750c4':'#c5c1cf'}" stroke-width="3" stroke-linecap="round"/>`;
   if(active){
    svg+=`<circle cx="${line.start[0]}" cy="${line.start[1]}" r="5" fill="#bb510c" stroke="white" stroke-width="1.5"/>`;
    if(step.action!=='look'&&Math.hypot(line.start[0]-line.direction[0],line.start[1]-line.direction[1])>6)svg+=`<path d="M${line.start.join(' ')} L${line.direction.join(' ')}" fill="none" stroke="#bd530c" stroke-width="2" marker-end="url(#arrow)"/>`;
   }
  }
  svg+='</g>';if(step.action==='draw')step.lines.forEach(id=>seen.add(id));
 });
});
svg+='</svg>';
writeFileSync('docs/drawing/d01-review.svg',svg);
await sharp(Buffer.from(svg)).png().toFile('docs/drawing/d01-review.png');

const reference=lesson.examples[0];
const art=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="800" height="800"><rect width="400" height="400" fill="white"/>${reference.lines.map(l=>`<path d="${l.d}" fill="${l.fill==='ink'?'#161616':'none'}" stroke="${l.fill==='ink'?'none':'#161616'}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;
writeFileSync('docs/drawing/d01-reference-v2.svg',art);
await sharp(Buffer.from(art)).png().toFile('docs/drawing/d01-reference-v2.png');
