import { useEffect, useRef } from 'react';
import { createHumanArtwork, HUMAN_ASSET_ROOT, HUMAN_IMAGE_NAMES } from '../../lib/yeoni/human-art';
const shapes = [['closed', '닫힘'], ['a', '아'], ['i', '이'], ['u', '우'], ['e', '에'], ['o', '오']] as const;
export default function HumanMouthPalette({ assets }: { assets?: Record<string, string> }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false, art: ReturnType<typeof createHumanArtwork> | null = null;
    const images = new Map<string, HTMLImageElement>();
    void Promise.all(HUMAN_IMAGE_NAMES.map(name => new Promise<void>((resolve, reject) => {
      const image = new Image(); images.set(name, image);
      image.onload = () => resolve(); image.onerror = () => reject(new Error('Human palette unavailable'));
      image.src = assets?.[name] ?? HUMAN_ASSET_ROOT + name;
    }))).then(() => {
      if (disposed) return;
      art = createHumanArtwork(images);
      root.current?.querySelectorAll('canvas').forEach(canvas => {
        canvas.getContext('2d')?.drawImage(art!.frame('open', canvas.dataset.mouthShape!), 400, 490, 260, 180, 0, 0, 208, 144);
      });
    }).catch(() => { /* The main stage retains its existing error fallback. */ });
    return () => { disposed = true; art?.dispose(); for (const image of images.values()) { image.onload = image.onerror = null; image.removeAttribute('src'); } images.clear(); };
  }, [assets]);
  return <section className="mouth-palette" aria-label="여섯 입 모양 비교"><h2>여섯 입 모양</h2><div ref={root}>
    {shapes.map(([shape, label]) => <figure key={shape}><canvas width={208} height={144} data-mouth-shape={shape} aria-label={`${label} 입 모양`} /><figcaption>{label}</figcaption></figure>)}
  </div><p>승인된 인간형 입 모양을 같은 배율로 비교해요. 우 모양은 이 음성에서 ‘쉬’의 둥글림에 사용되며, 독립적인 ‘우’ 발음은 표본에 없어요.</p></section>;
}
