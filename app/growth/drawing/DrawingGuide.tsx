import { useId } from "react";
import type { DrawingGuideKind } from "../../data/drawingPractice";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const faint = { ...stroke, strokeWidth: 2, opacity: 0.58 };

const GUIDE_LABELS: Record<DrawingGuideKind, string> = {
  "still-life": "머그컵, 둥근 과일, 작은 상자를 배치한 시작·마지막 비교 정물",
  "straight-lines": "두 점 사이의 가로·세로·대각선 직선 연습",
  curves: "C자와 S자 곡선 세 줄 연습",
  ellipses: "방향과 납작한 정도가 다른 원과 타원 연습",
  "flat-shapes": "사각형·삼각형·원과 잎·물방울·구름 도형",
  "shape-layout": "크기와 위치가 다른 도형 배열과 중심점",
  "cup-spoon": "컵과 숟가락의 큰 도형과 중심선",
  "basic-forms": "상자·원기둥·구 기본 입체",
  "cross-contour": "구·원기둥·상자를 감싸는 표면 방향선",
  "value-scale": "흰색부터 검정까지 다섯 단계 명암띠",
  "sphere-light": "왼쪽 위 빛을 받는 구와 바닥 그림자",
  "form-light": "같은 빛을 받는 상자·원기둥·원뿔",
  "constructed-objects": "컵·물병·상자를 기본 입체로 나눈 예시",
  "two-object-study": "컵과 둥근 과일의 겹침과 그림자",
  "one-point": "소실점 하나로 모이는 상자와 깊이선",
  "two-point": "좌우 두 소실점으로 향하는 상자",
  cylinders: "상자 안에서 방향이 달라지는 원기둥과 중심축",
  "bounding-box": "물병·컵·신발을 감싸는 사각형과 중심선",
  "negative-space": "컵 손잡이·가위 구멍·포크 사이의 빈 공간",
  "three-object-study": "상자·캔·과일 세 물건 정물",
  "observe-redraw": "첫 그림에서 오류 하나를 찾아 다시 그리는 순서",
  "memory-redraw": "대상을 가리고 기억으로 그린 뒤 비교하는 순서",
  "construction-memory": "상자와 원기둥 조합으로 물건을 기억하는 순서",
  "light-group": "빛 하나를 공유하는 구·상자·원기둥 묶음",
  thumbnails: "크기·간격·겹침이 다른 작은 구도 여섯 개",
  "new-still-life": "물병·배·책으로 구성한 첫 전이 검사 정물",
  "transfer-still-life": "탁상등·주전자·접힌 천으로 구성한 최종 전이 검사 정물",
};

function EllipseStack({ x, y, width, height = 34 }: { x: number; y: number; width: number; height?: number }) {
  return <>
    <ellipse cx={x} cy={y} rx={width / 2} ry={height / 2} {...stroke} />
    <line x1={x} y1={y - height / 2 - 12} x2={x} y2={y + height / 2 + 12} {...faint} />
  </>;
}

function Mug({ x = 90, y = 90, scale = 1 }: { x?: number; y?: number; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <ellipse cx="70" cy="25" rx="66" ry="19" {...stroke} />
    <path d="M4 25v104c0 14 28 25 66 25s66-11 66-25V25" {...stroke} />
    <path d="M136 58c46-9 55 10 52 33-3 25-22 39-52 28" {...stroke} />
    <ellipse cx="70" cy="129" rx="66" ry="25" {...faint} />
    <line x1="70" y1="3" x2="70" y2="156" {...faint} />
  </g>;
}

function Box({ x = 330, y = 150, scale = 1 }: { x?: number; y?: number; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <path d="M0 36 62 0l92 30-61 39Z" {...stroke} />
    <path d="M0 36v78l93 36V69M154 30v79l-61 41" {...stroke} />
    <path d="m0 114 62-40 92 35" {...faint} />
  </g>;
}

function Cone({ x = 0, y = 0, scale = 1 }: { x?: number; y?: number; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <ellipse cx="70" cy="160" rx="58" ry="18" {...stroke} />
    <path d="M12 160 70 8l58 152" {...stroke} />
    <line x1="70" y1="8" x2="70" y2="178" {...faint} />
  </g>;
}

function Sphere({ cx = 260, cy = 180, r = 62 }: { cx?: number; cy?: number; r?: number }) {
  return <g>
    <circle cx={cx} cy={cy} r={r} {...stroke} />
    <path d={`M${cx - r * .84} ${cy - r * .15}c${r * .35} ${-r * .32} ${r * 1.35} ${-r * .32} ${r * 1.68} 0`} {...faint} />
    <path d={`M${cx - r * .83} ${cy + r * .18}c${r * .42} ${r * .3} ${r * 1.3} ${r * .3} ${r * 1.66} 0`} {...faint} />
    <path d={`M${cx} ${cy - r}c${-r * .34} ${r * .4} ${-r * .34} ${r * 1.6} 0 ${r * 2}`} {...faint} />
  </g>;
}

function LightArrow() {
  return <g aria-hidden="true"><path d="M54 42 122 84m-34-58 34 58-66-5" {...stroke} /><text x="42" y="29" fontSize="16" fontWeight="700" fill="currentColor">빛</text></g>;
}

function LitBox({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <ellipse cx="105" cy="150" rx="112" ry="20" fill="#44434e" opacity=".28" />
    <path d="M0 36 62 0l92 30-61 39Z" fill="#f1f1f4" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
    <path d="M0 36v78l93 36V69Z" fill="#aaaab2" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
    <path d="M93 69 154 30v79l-61 41Z" fill="#55545f" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
    <text x="63" y="34" fontSize="17" fontWeight="800" fill="#34313f">1</text><text x="43" y="100" fontSize="17" fontWeight="800" fill="#34313f">2</text><text x="119" y="104" fontSize="17" fontWeight="800" fill="#fff">3</text>
  </g>;
}

function LitCylinder({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <ellipse cx="75" cy="190" rx="86" ry="17" fill="#44434e" opacity=".28" />
    <ellipse cx="55" cy="24" rx="45" ry="15" fill="#f1f1f4" stroke="currentColor" strokeWidth="3" />
    <path d="M10 24v130c0 22 90 22 90 0V24" fill="#aaaab2" stroke="currentColor" strokeWidth="3" />
    <path d="M58 10c24 3 42 8 42 14v130c0 10-19 16-42 17Z" fill="#55545f" opacity=".82" />
    <text x="29" y="88" fontSize="17" fontWeight="800" fill="#34313f">2</text><text x="76" y="88" fontSize="17" fontWeight="800" fill="#fff">3</text><text x="48" y="27" fontSize="15" fontWeight="800" fill="#34313f">1</text>
  </g>;
}

function LitCone({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <ellipse cx="92" cy="176" rx="82" ry="18" fill="#44434e" opacity=".28" />
    <path d="M12 160 70 8l58 152Z" fill="#aaaab2" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
    <path d="M70 8 128 160H70Z" fill="#55545f" opacity=".82" />
    <ellipse cx="70" cy="160" rx="58" ry="18" fill="#777680" stroke="currentColor" strokeWidth="3" />
    <path d="M45 72 70 8l-8 69Z" fill="#f1f1f4" opacity=".92" />
    <text x="45" y="116" fontSize="17" fontWeight="800" fill="#34313f">2</text><text x="91" y="120" fontSize="17" fontWeight="800" fill="#fff">3</text><text x="55" y="62" fontSize="15" fontWeight="800" fill="#34313f">1</text>
  </g>;
}

function LitSphere({ id, cx, cy, r }: { id: string; cx: number; cy: number; r: number }) {
  return <g>
    <defs><radialGradient id={id} cx="31%" cy="27%"><stop offset="0" stopColor="#fff" /><stop offset=".48" stopColor="#c9c9d0" /><stop offset="1" stopColor="#44434e" /></radialGradient></defs>
    <ellipse cx={cx + r * .55} cy={cy + r * 1.08} rx={r * 1.15} ry={r * .24} fill="#44434e" opacity=".3" />
    <circle cx={cx} cy={cy} r={r} fill={`url(#${id})`} stroke="currentColor" strokeWidth="3" />
    <text x={cx - r * .38} y={cy - r * .28} fontSize="15" fontWeight="800" fill="#34313f">1</text><text x={cx - r * .05} y={cy + r * .08} fontSize="15" fontWeight="800" fill="#34313f">2</text><text x={cx + r * .48} y={cy + r * .28} fontSize="15" fontWeight="800" fill="#fff">3</text>
  </g>;
}

function LitMug({ id, x, y, scale = 1 }: { id: string; x: number; y: number; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <defs><linearGradient id={id} x1="0" x2="1"><stop offset="0" stopColor="#efeff2" /><stop offset=".55" stopColor="#aaaab2" /><stop offset="1" stopColor="#55545f" /></linearGradient></defs>
    <ellipse cx="94" cy="163" rx="112" ry="18" fill="#44434e" opacity=".28" />
    <path d="M4 25v104c0 14 28 25 66 25s66-11 66-25V25Z" fill={`url(#${id})`} stroke="currentColor" strokeWidth="3" />
    <ellipse cx="70" cy="25" rx="66" ry="19" fill="#f1f1f4" stroke="currentColor" strokeWidth="3" />
    <path d="M136 58c46-9 55 10 52 33-3 25-22 39-52 28" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    <text x="29" y="83" fontSize="16" fontWeight="800" fill="#34313f">1</text><text x="78" y="91" fontSize="16" fontWeight="800" fill="#34313f">2</text><text x="116" y="99" fontSize="16" fontWeight="800" fill="#fff">3</text>
  </g>;
}

function PerspectiveGrid({ twoPoint = false }: { twoPoint?: boolean }) {
  return <g>
    <line x1="36" y1="175" x2="604" y2="175" {...faint} />
    {twoPoint ? <>
      <circle cx="50" cy="175" r="5" fill="currentColor" /><circle cx="590" cy="175" r="5" fill="currentColor" />
      <line x1="315" y1="90" x2="315" y2="262" {...stroke} />
      <path d="M315 90 50 175l265 87M315 90l275 85-275 87" {...stroke} />
      <path d="M220 120v112M420 123v108" {...stroke} />
    </> : <>
      <circle cx="320" cy="175" r="5" fill="currentColor" />
      <rect x="92" y="82" width="120" height="88" {...stroke} />
      <path d="m92 82 228 93M212 82l108 93M92 170l228 5M212 170l108 5" {...faint} />
      <rect x="435" y="205" width="112" height="82" {...stroke} />
      <path d="m435 205-115-30m227 30-227-30m115 112-115-112m227 112-227-112" {...faint} />
    </>}
  </g>;
}

function ValueScale() {
  const fills = ["#fff", "#d7d7dc", "#9b9ba5", "#5a5965", "#242231"];
  return <g>
    {fills.map((fill, index) => <g key={fill}><rect x={80 + index * 96} y="128" width="96" height="92" fill={fill} stroke="currentColor" strokeWidth="2" /><text x={128 + index * 96} y="252" textAnchor="middle" fontSize="20" fill="currentColor">{index + 1}</text></g>)}
  </g>;
}

function GuideContent({ kind, idPrefix }: { kind: DrawingGuideKind; idPrefix: string }) {
  if (kind === "straight-lines") return <>{[74, 128, 182, 236, 290].map((y, row) => <g key={y}><circle cx="82" cy={y} r="6" fill="currentColor" /><circle cx="558" cy={y + (row % 2 ? 24 : -12)} r="6" fill="currentColor" /><line x1="82" y1={y} x2="558" y2={y + (row % 2 ? 24 : -12)} {...faint} /></g>)}</>;
  if (kind === "curves") return <><path d="M80 92c120-75 180 75 290 0s155 20 190 0" {...faint} /><path d="M80 178c105-95 170 95 260 0s145-20 220 0" {...faint} /><path d="M80 270c70-68 150-68 210 0 62 70 170 64 270-18" {...faint} /></>;
  if (kind === "ellipses") return <>{[[120,105,86,34],[320,105,90,56],[520,105,52,94],[140,255,110,48],[365,250,95,74],[540,255,65,42]].map(([x,y,w,h]) => <EllipseStack key={`${x}-${y}`} x={x} y={y} width={w} height={h} />)}</>;
  if (kind === "flat-shapes") return <><rect x="70" y="70" width="125" height="100" {...stroke} /><path d="m275 170 75-112 75 112Z" {...stroke} /><circle cx="530" cy="115" r="58" {...stroke} /><path d="M90 265c52-76 120-48 138 14-56 42-109 31-138-14Z" {...stroke} /><path d="M334 208c52 0 75 50 40 104-35-54-92-65-40-104Z" {...stroke} /><path d="M470 280c0-48 46-68 77-38 32-25 78 9 57 50-31 30-102 29-134-12Z" {...stroke} /></>;
  if (kind === "shape-layout") return <><rect x="70" y="70" width="220" height="210" rx="18" {...faint} /><circle cx="145" cy="132" r="42" {...stroke} /><rect x="190" y="178" width="74" height="68" {...stroke} /><path d="m410 90 102 46-57 92-104-48Z" {...stroke} /><circle cx="538" cy="254" r="38" {...stroke} />{[[145,132],[227,212],[461,159],[538,254]].map(([x,y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="4" fill="#7c3aed" />)}</>;
  if (kind === "cup-spoon") return <><LightArrow /><LitMug id={`${idPrefix}-cup-spoon-mug`} x={92} y={83} scale={.9} /><path d="M406 97c30-14 58 17 41 44-13 20-36 25-54 10-21-18-10-43 13-54Zm17 55-77 132c-8 13-26 3-20-10l68-139" fill="#aaaab2" stroke="currentColor" strokeWidth="3" /><path d="m423 152-77 132" stroke="#55545f" strokeWidth="7" opacity=".75" /></>;
  if (kind === "basic-forms") return <><Box x={55} y={105} scale={.9} /><g transform="translate(250 65)"><EllipseStack x={70} y={35} width={112} height={34} /><path d="M14 35v164M126 35v164" {...stroke} /><ellipse cx="70" cy="199" rx="56" ry="17" {...stroke} /></g><Sphere cx={520} cy={182} r={70} /></>;
  if (kind === "cross-contour") return <><Sphere cx={125} cy={180} r={80} /><g transform="translate(245 56)"><ellipse cx="65" cy="35" rx="54" ry="18" {...stroke} /><path d="M11 35v190M119 35v190" {...stroke} /><ellipse cx="65" cy="225" rx="54" ry="18" {...stroke} />{[78,122,166].map(y => <ellipse key={y} cx="65" cy={y} rx="54" ry="18" {...faint} />)}</g><Box x={430} y={105} scale={.9} /></>;
  if (kind === "value-scale") return <ValueScale />;
  if (kind === "sphere-light") return <><LightArrow /><LitSphere id={`${idPrefix}-sphere-light`} cx={330} cy={176} r={96} /></>;
  if (kind === "form-light") return <><LightArrow /><LitBox x={105} y={135} scale={.72} /><LitCylinder x={305} y={105} /><LitCone x={455} y={90} scale={.75} /></>;
  if (kind === "light-group") return <><LightArrow /><LitBox x={105} y={135} scale={.72} /><LitCylinder x={305} y={105} /><LitSphere id={`${idPrefix}-light-group-sphere`} cx={535} cy={205} r={66} /></>;
  if (kind === "constructed-objects") return <><Mug x={60} y={95} scale={.75} /><g transform="translate(260 65)"><path d="M45 0h55l9 45 16 26v176H20V71l16-26Z" {...stroke} /><line x1="72" y1="0" x2="72" y2="247" {...faint} /><ellipse cx="72" cy="70" rx="53" ry="14" {...faint} /></g><Box x={438} y={150} scale={.7} /></>;
  if (kind === "two-object-study") return <><LightArrow /><LitMug id={`${idPrefix}-two-object-mug`} x={95} y={105} scale={.85} /><LitSphere id={`${idPrefix}-two-object-sphere`} cx={455} cy={220} r={74} /></>;
  if (kind === "one-point") return <PerspectiveGrid />;
  if (kind === "two-point") return <PerspectiveGrid twoPoint />;
  if (kind === "cylinders") return <><Box x={60} y={120} scale={.8} /><g transform="translate(290 55) rotate(18 80 120)"><ellipse cx="80" cy="30" rx="62" ry="21" {...stroke} /><path d="M18 30v190M142 30v190" {...stroke} /><ellipse cx="80" cy="220" rx="62" ry="21" {...stroke} /><line x1="80" y1="5" x2="80" y2="245" {...faint} /></g><g transform="translate(490 90)"><ellipse cx="50" cy="24" rx="42" ry="15" {...stroke} /><path d="M8 24v170M92 24v170" {...stroke} /><ellipse cx="50" cy="194" rx="42" ry="15" {...stroke} /><line x1="50" y1="0" x2="50" y2="216" {...faint} /></g></>;
  if (kind === "bounding-box") return <><g><rect x="50" y="50" width="145" height="250" {...faint} /><path d="M92 58h60l12 54 18 36v140H63V148l18-36Z" {...stroke} /><line x1="122" y1="50" x2="122" y2="300" {...faint} /></g><g><rect x="242" y="92" width="150" height="205" {...faint} /><Mug x={248} y={105} scale={.72} /></g><g><rect x="430" y="138" width="165" height="130" {...faint} /><path d="M445 230c28-58 65-72 96-48 19 14 32 30 47 42l-15 30H446Z" {...stroke} /><line x1="430" y1="203" x2="595" y2="203" {...faint} /></g></>;
  if (kind === "negative-space") return <><Mug x={55} y={90} scale={.7} /><path d="M150 138c28-2 38 13 34 35-5 22-18 31-34 26" fill="#f4f0ff" stroke="#7c3aed" strokeWidth="3" /><g transform="translate(265 80)"><ellipse cx="44" cy="52" rx="38" ry="49" {...stroke} /><ellipse cx="129" cy="52" rx="38" ry="49" {...stroke} /><ellipse cx="44" cy="52" rx="20" ry="31" fill="#f4f0ff" stroke="#7c3aed" strokeWidth="3" /><ellipse cx="129" cy="52" rx="20" ry="31" fill="#f4f0ff" stroke="#7c3aed" strokeWidth="3" /><path d="m70 90 100 190M104 90 12 280" {...stroke} /></g><g transform="translate(510 76)"><path d="M12 0v220M35 0v220M58 0v220M81 0v220M12 74h69" {...stroke} /><rect x="23" y="8" width="12" height="62" fill="#f4f0ff" /><rect x="46" y="8" width="12" height="62" fill="#f4f0ff" /></g></>;
  if (kind === "still-life") return <><LightArrow /><line x1="45" y1="300" x2="595" y2="300" {...faint} /><LitMug id={`${idPrefix}-still-life-mug`} x={70} y={102} scale={.85} /><LitSphere id={`${idPrefix}-still-life-sphere`} cx={355} cy={220} r={65} /><path d="M355 154c8-23 25-31 45-22" {...stroke} /><LitBox x={425} y={165} scale={.78} /></>;
  if (kind === "three-object-study") return <><line x1="45" y1="300" x2="595" y2="300" {...faint} /><Box x={55} y={170} scale={.72} /><g transform="translate(300 105)"><ellipse cx="55" cy="25" rx="48" ry="16" {...stroke} /><path d="M7 25v165M103 25v165" {...stroke} /><ellipse cx="55" cy="190" rx="48" ry="16" {...stroke} /><line x1="55" y1="4" x2="55" y2="210" {...faint} /></g><Sphere cx={515} cy={230} r={64} /></>;
  if (kind === "new-still-life") return <><defs><linearGradient id={`${idPrefix}-bottle-light`} x1="0" x2="1"><stop offset="0" stopColor="#f1f1f4" /><stop offset=".58" stopColor="#aaaab2" /><stop offset="1" stopColor="#55545f" /></linearGradient><linearGradient id={`${idPrefix}-pear-light`} x1="0" x2="1"><stop offset="0" stopColor="#f1f1f4" /><stop offset=".55" stopColor="#aaaab2" /><stop offset="1" stopColor="#55545f" /></linearGradient></defs><LightArrow /><line x1="45" y1="310" x2="605" y2="310" {...faint} /><ellipse cx="175" cy="310" rx="120" ry="18" fill="#44434e" opacity=".25" /><g transform="translate(70 55)"><path d="M45 0h55l8 48 18 28v210H18V76l18-28Z" fill={`url(#${idPrefix}-bottle-light)`} stroke="currentColor" strokeWidth="3" /><line x1="72" y1="0" x2="72" y2="286" {...faint} /></g><ellipse cx="365" cy="286" rx="91" ry="18" fill="#44434e" opacity=".25" /><g transform="translate(280 130)"><path d="M76 6c35 21 58 69 41 119-15 43-81 55-112 12-26-37 10-101 71-131Z" fill={`url(#${idPrefix}-pear-light)`} stroke="currentColor" strokeWidth="3" /><path d="M76 6c4-24 20-35 40-31" {...stroke} /></g><LitBox x={425} y={175} scale={.85} /></>;
  if (kind === "transfer-still-life") return <><defs><linearGradient id={`${idPrefix}-lamp-light`} x1="0" x2="1"><stop offset="0" stopColor="#f1f1f4" /><stop offset=".6" stopColor="#aaaab2" /><stop offset="1" stopColor="#55545f" /></linearGradient><linearGradient id={`${idPrefix}-kettle-light`} x1="0" x2="1"><stop offset="0" stopColor="#f1f1f4" /><stop offset=".58" stopColor="#aaaab2" /><stop offset="1" stopColor="#55545f" /></linearGradient></defs><LightArrow /><line x1="45" y1="310" x2="605" y2="310" {...faint} /><ellipse cx="145" cy="302" rx="105" ry="17" fill="#44434e" opacity=".25" /><g transform="translate(55 70)"><path d="M75 0 15 92h120Z" fill={`url(#${idPrefix}-lamp-light)`} stroke="currentColor" strokeWidth="3" /><line x1="75" y1="92" x2="75" y2="220" {...stroke} /><path d="M20 220h110" {...stroke} /></g><ellipse cx="345" cy="300" rx="125" ry="20" fill="#44434e" opacity=".25" /><g transform="translate(250 105)"><ellipse cx="75" cy="35" rx="58" ry="20" fill="#f1f1f4" stroke="currentColor" strokeWidth="3" /><path d="M17 35v145c0 28 116 28 116 0V35" fill={`url(#${idPrefix}-kettle-light)`} stroke="currentColor" strokeWidth="3" /><path d="M133 70c50-8 65 18 51 46-10 21-28 30-51 23M17 88C-18 80-22 53 17 48" {...stroke} /></g><ellipse cx="530" cy="310" rx="100" ry="16" fill="#44434e" opacity=".25" /><path d="M455 180c28-26 60-23 78 3 21-22 58-7 62 24v82H445v-74c0-14 3-25 10-35Z" fill="#aaaab2" stroke="currentColor" strokeWidth="3" /><path d="M532 183c21-22 58-7 62 24v82h-62Z" fill="#55545f" opacity=".75" /><path d="M445 245c38-20 89 25 150-5" {...faint} /></>;
  if (kind === "observe-redraw") return <><g transform="translate(40 30)"><Mug x={0} y={20} scale={.58} /><text x="70" y="238" textAnchor="middle" fontSize="17" fill="currentColor">첫 시도</text></g><path d="M247 175h98m-20-20 20 20-20 20" {...stroke} /><g transform="translate(380 30)"><Mug x={0} y={20} scale={.58} /><circle cx="104" cy="122" r="33" fill="none" stroke="#7c3aed" strokeWidth="4" strokeDasharray="8 7" /><text x="70" y="238" textAnchor="middle" fontSize="17" fill="currentColor">한 가지 수정</text></g></>;
  if (kind === "memory-redraw") return <><g transform="translate(50 70)"><Sphere cx={80} cy={95} r={62} /><path d="M80 31c8-30 28-39 50-30" {...stroke} /></g><path d="M255 95h120m-22-20 22 20-22 20M375 245H255m22-20-22 20 22 20" {...stroke} /><rect x="420" y="56" width="150" height="230" rx="18" fill="#f5f4fa" stroke="currentColor" strokeWidth="3" strokeDasharray="8 7" /><text x="495" y="165" textAnchor="middle" fontSize="22" fill="currentColor">화면을</text><text x="495" y="197" textAnchor="middle" fontSize="22" fill="currentColor">가리고 그리기</text></>;
  if (kind === "construction-memory") return <><Box x={70} y={120} scale={.65} /><g transform="translate(235 80)"><ellipse cx="65" cy="32" rx="48" ry="16" {...stroke} /><path d="M17 32v165M113 32v165" {...stroke} /><ellipse cx="65" cy="197" rx="48" ry="16" {...stroke} /><line x1="65" y1="5" x2="65" y2="220" {...faint} /></g><path d="M397 180h60m-18-18 18 18-18 18" {...stroke} /><Mug x={465} y={100} scale={.68} /></>;
  if (kind === "thumbnails") return <>{[0,1,2,3,4,5].map(index => { const x=55+(index%3)*190; const y=55+Math.floor(index/3)*145; return <g key={index}><rect x={x} y={y} width="150" height="105" {...faint} /><rect x={x+18+(index%2)*18} y={y+28} width="40" height="55" fill="#7c3aed" opacity=".25" /><circle cx={x+92} cy={y+67-(index%3)*8} r={22+(index%2)*5} fill="#f59e0b" opacity=".38" /><rect x={x+112-(index%2)*20} y={y+45} width="24" height="40" fill="#2563eb" opacity=".3" /></g>; })}</>;
  return <><Mug x={90} y={100} scale={.8} /><Sphere cx={420} cy={220} r={66} /></>;
}

export default function DrawingGuide({ kind, hidden = false, transparent = false }: { kind: DrawingGuideKind; hidden?: boolean; transparent?: boolean }) {
  const idPrefix = useId().replaceAll(":", "");
  return <div className={`drawing-guide w-full overflow-hidden rounded-2xl ${transparent ? "drawing-guide-overlay bg-transparent" : "border border-violet-100 bg-white"} ${hidden ? "drawing-guide-hidden opacity-0" : "opacity-100"}`} aria-hidden={hidden}>
    <svg viewBox="0 0 640 360" role="img" aria-label={GUIDE_LABELS[kind]} className="h-auto w-full text-[#34313f]" preserveAspectRatio="xMidYMid meet">
      {transparent ? null : <rect width="640" height="360" fill="#fdfcff" />}
      <GuideContent kind={kind} idPrefix={idPrefix} />
    </svg>
  </div>;
}
