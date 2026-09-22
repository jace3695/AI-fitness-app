// Exact SVG teaching diagrams: inspect every panel, not only a finished character.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';
const pack = JSON.parse(readFileSync('content/drawing/foundations-v1.json','utf8'));
const lessons = pack.lessons.slice(8,16);
const esc = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const text = (s,y,size=18) => [...s].reduce((a,c,i) => { const n=Math.floor(i/25); a[n]=(a[n]??'')+c; return a; },[]).map((s,i)=>`<text x="15" y="${y+i*24}" font-family="sans-serif" font-size="${size}">${esc(s)}</text>`).join('');
const header = (w,h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="white"/><defs><marker id="arrow" markerWidth="5" markerHeight="5" refX="3.5" refY="2.5" orient="auto"><path d="M0 0 L5 2.5 L0 5Z" fill="#bd530c"/></marker></defs>`;
const dir='docs/drawing/stage-two';mkdirSync(dir,{recursive:true});
let finals=header(1600,1600);
for (const [li,lesson] of lessons.entries()) {
 const rows=Math.ceil(lesson.steps.length/3);
 let svg=header(1200,rows*560*lesson.examples.length);
 for (const [ei,ex] of lesson.examples.entries()) {
  const seen=new Set();
  for (const [si,step] of lesson.steps.entries()) {
   svg+=`<g transform="translate(${si%3*400},${(ei*rows+Math.floor(si/3))*560})">`+text(`${lesson.id} ${ei+1}번 예제 · ${si+1} / ${lesson.steps.length}`,22);
   const showReference=step.action==='compare'&&step.text.includes('완성 외곽 겹치기');
   if(showReference) svg+=ex.lines.filter(l=>!['guide','gesture'].includes(l.group)).map(l=>`<path d="${l.d}" opacity=".6" fill="${l.fill==='ink'?'#64748b':'none'}" stroke="${l.fill==='ink'?'none':'#64748b'}" stroke-width="2" stroke-linecap="round"/>`).join('');
   for (const l of ex.lines) {
    const active=step.lines.includes(l.id), current=(active&&step.action!=='look')||(showReference&&l.group==='guide'&&seen.has(l.id));
    if(seen.has(l.id)||current)svg+=`<path d="${l.d}" fill="${l.fill==='ink'?(current?'#7750c4':'#c5c1cf'):'none'}" stroke="${l.fill==='ink'?'none':current?'#7750c4':'#c5c1cf'}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    if(active){svg+=`<circle cx="${l.start[0]}" cy="${l.start[1]}" r="5" fill="#bb510c" stroke="white" stroke-width="1.5"/>`;
     if(current&&Math.hypot(l.start[0]-l.direction[0],l.start[1]-l.direction[1])>6)svg+=`<path d="M${l.start.join(' ')} L${l.direction.join(' ')}" fill="none" stroke="#bd530c" stroke-width="2" marker-end="url(#arrow)"/>`;
    }
   }
   svg+=(showReference?text('겹치기를 켠 뒤의 모습',370,14):'')+text(step.text,400,16)+'</g>';if(step.action==='draw')step.lines.forEach(id=>seen.add(id));
  }
  const i=li*2+ei;
  finals+=`<g transform="translate(${i%4*400},${Math.floor(i/4)*400})">`+text(`${lesson.id} · ${ex.name}`,24)+ex.lines.filter(l=>!['guide','gesture'].includes(l.group)).map(l=>`<path d="${l.d}" fill="${l.fill==='ink'?'#161616':'none'}" stroke="${l.fill==='ink'?'none':'#161616'}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`).join('')+'</g>';
 }
 svg+='</svg>';writeFileSync(`${dir}/${lesson.id.toLowerCase()}-steps.svg`,svg);await sharp(Buffer.from(svg)).png().toFile(`${dir}/${lesson.id.toLowerCase()}-steps.png`);
}
finals+='</svg>';writeFileSync(`${dir}/examples.svg`,finals);await sharp(Buffer.from(finals)).png().toFile(`${dir}/examples.png`);
console.log('D09–D16:',lessons.reduce((n,l)=>n+l.examples.length,0),'examples;',lessons.reduce((n,l)=>n+l.examples.length*l.steps.length,0),'panels');

// Separate review for easy-task context; do not count these as extra lessons/examples.
let helpers=header(1200,1120);
let hi=0;
for(const lesson of lessons.filter(l=>l.easyLines?.length))for(const ex of lesson.examples){
 const taught=new Set((lesson.id==='D12'?[]:lesson.steps).filter(s=>s.action==='draw').flatMap(s=>s.lines));
 helpers+=`<g transform="translate(${hi%3*400},${Math.floor(hi/3)*560})">`+text(`${lesson.id} · 쉬운 과제 · ${ex.name}`,22);
 for(const l of ex.lines.filter(l=>taught.has(l.id)||lesson.easyLines.includes(l.id)))helpers+=`<path d="${l.d}" fill="${l.fill==='ink'?'#c5c1cf':'none'}" stroke="${l.fill==='ink'?'none':'#c5c1cf'}" stroke-width="3" stroke-linecap="round"/>`;
 helpers+=text(lesson.easier,400,16)+'</g>';hi++;
}
helpers+='</svg>';writeFileSync(`${dir}/easy-tasks.svg`,helpers);await sharp(Buffer.from(helpers)).png().toFile(`${dir}/easy-tasks.png`);
