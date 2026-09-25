import type {Example,OriginalDesign,OriginalFrame} from './model.ts';
export function originalLines(c:OriginalDesign,expression:OriginalFrame['expression']='neutral',pose:OriginalFrame['pose']='stand'):Example['lines']{
 const line=(id:string,d:string,group:'shape'|'detail'='shape',fill?:'ink')=>({id,label:id,d,start:[200,100] as [number,number],direction:[200,120] as [number,number],group,...(fill?{fill}: {})});
 const rx=c.body==='round'?82:59,top=c.body==='round'?127:98,bottom=pose==='sit'?277:296;
 const apex=top+(214-top)*.25;
 const lines=[line('body',`M${200-rx} 214 C${200-rx} ${top} ${200+rx} ${top} ${200+rx} 214 C${200+rx} ${bottom} ${200-rx} ${bottom} ${200-rx} 214 Z`)];
 if(c.motif==='sprout')lines.push(line('mark',c.mark==='single'?`M200 ${apex} Q171 91 222 68 Q250 106 200 ${apex} Z`:`M200 ${apex} Q146 114 161 83 Q200 87 200 125 Q201 75 235 81 Q243 122 200 ${apex} Z`));
 else lines.push(line('mark',c.mark==='single'?`M183 ${apex+4} Q155 85 185 79 Q219 82 200 ${apex+2}`:`M175 ${apex+5} Q163 92 179 94 L195 117 Q190 75 205 83 L219 ${apex+5}`));
 lines.push(line('arm-left',pose==='sit'?`M${204-rx} 225 Q162 255 183 250`:`M${203-rx} 219 Q${179-rx} 240 ${202-rx} 250`));
 lines.push(line('arm-right',pose==='wave'?`M${197+rx} 211 Q302 184 299 151 Q312 143 317 156 Q331 195 ${197+rx} 235`:`M${197+rx} 219 Q${221+rx} 240 ${198+rx} 250`));
 lines.push(line('feet',pose==='sit'?'M171 258 Q133 278 143 291 Q170 298 184 263 M217 259 Q247 282 265 276 Q280 288 269 297 Q246 305 211 263':pose==='walk'?'M175 272 L149 309 L124 314 M214 273 L244 310 L268 319':'M176 272 L170 311 L150 311 M224 272 L230 311 L250 311'));
 lines.push(line('eye-left',expression==='happy'?'M165 205 Q173 192 181 205':expression==='surprised'?'M167 202 A6 9 0 1 0 179 202 A6 9 0 1 0 167 202':'M169 201 A4 5 0 1 0 177 201 A4 5 0 1 0 169 201','detail',expression==='neutral'?'ink':undefined));
 lines.push(line('eye-right',expression==='happy'?'M219 205 Q227 192 235 205':expression==='surprised'?'M221 202 A6 9 0 1 0 233 202 A6 9 0 1 0 221 202':'M223 201 A4 5 0 1 0 231 201 A4 5 0 1 0 223 201','detail',expression==='neutral'?'ink':undefined));
 lines.push(line('mouth',expression==='surprised'?'M193 225 A7 10 0 1 0 207 225 A7 10 0 1 0 193 225':c.motif==='bird'?'M190 221 L210 221 L200 232 Z':expression==='happy'?'M188 221 Q200 247 212 221':'M192 225 Q200 233 208 225','detail'));
 return lines;
}
export const ORIGINAL_LABELS={neutral:'기본',happy:'반가움',surprised:'놀람',stand:'기본 자세',wave:'인사',sit:'앉기',walk:'걷기'};
