import { useEffect, useRef } from 'react';
import { CAT_MOTION_ASSET, createCatArtwork } from '../../lib/yeoni/cat-art';
import type { Viseme } from '../../lib/yeoni/lip-sync';

const shapes: ReadonlyArray<readonly [Viseme, string]> = [
  ['closed', '닫힘'], ['a', '아'], ['i', '이'], ['u', '우'], ['e', '에'], ['o', '오'],
];
function Mouth({ shape, label }: { shape: Viseme; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d'); if (!ctx) return;
    let disposed = false, art: ReturnType<typeof createCatArtwork> | null = null;
    const image = new Image();
    image.onload = () => {
      if (disposed) return;
      art = createCatArtwork(image);
      ctx.drawImage(art.frame('open', shape), 153, 187, 51, 36, 1, 0, 102, 72);
    };
    image.src = CAT_MOTION_ASSET;
    return () => { disposed = true; image.onload = null; image.removeAttribute('src'); art?.dispose(); };
  }, [shape]);
  return <figure><canvas ref={canvas} width={104} height={72} data-mouth-shape={shape} aria-label={`${label} 입 모양`} /><figcaption>{label}</figcaption></figure>;
}
export default function MouthPalette() {
  return <section className="mouth-palette" aria-label="여섯 입 모양 비교">
    <h2>여섯 입 모양</h2><div>{shapes.map(([shape, label]) => <Mouth key={shape} shape={shape} label={label} />)}</div>
    <p>위 캐릭터와 같은 입 모양을 멈춘 상태에서 비교해요.</p>
  </section>;
}
