'use client';

import { useEffect, useRef, useState } from 'react';
import { wallPushupPose } from '../lib/wallPushupMotion';

/** Drawn in code for this app. No external imagery, motion files or requests. */
export default function WallPushupDemo() {
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [slow, setSlow] = useState(false);
  const [progress, setProgress] = useState(0);
  const position = useRef(0);
  useEffect(() => {
    const stop = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange', stop);
    return () => document.removeEventListener('visibilitychange', stop);
  }, []);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last: number | undefined;
    const tick = (now: number) => {
      const delta = last === undefined ? 0 : Math.min(now - last, 100);
      last = now;
      let next = position.current + delta / (slow ? 12000 : 6000);
      if (next >= 1) {
        if (loop) next %= 1;
        else { next = 1; setPlaying(false); }
      }
      position.current = next;
      setProgress(next);
      if (next < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, loop, slow]);
  const seek = (value: number) => { setPlaying(false); position.current = value; setProgress(value); };
  const pose = wallPushupPose(progress);
  const points = (...names: (keyof typeof pose)[]) => names.map(name => `${pose[name].x},${pose[name].y}`).join(' ');
  return <section aria-label="벽 푸시업 측면 도해" className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-slate-800">
    <p className="font-bold">벽 푸시업 · 자체 제작 측면 도해</p>
    <p className="mt-1 text-xs">손과 발을 고정하고 팔꿈치를 굽혔다 펴는 흐름을 보여 줍니다. 손 간격·팔꿈치 벌림·견갑 움직임과 개인별 가동 범위는 표현하지 않습니다. 전문가의 자세 검증을 받은 시범은 아닙니다.</p>
    <svg viewBox="0 0 300 300" role="img" aria-label="벽에 손을 대고 몸통을 곧게 유지하는 사람 형태의 측면 도해" className="mx-auto w-full max-w-72">
      <path d="M210 30V278H45" fill="none" stroke="#94a3b8" strokeWidth="3" />
      <text x="225" y="70" fontSize="14" fill="#475569">벽</text>
      <g fill="none" stroke="#3730a3" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round">
        <polyline points={points('ankle', 'knee', 'hip', 'shoulder')} />
        <polyline points={points('shoulder', 'elbow', 'hand')} />
        <line x1={pose.shoulder.x} y1={pose.shoulder.y} x2={pose.head.x} y2={pose.head.y} />
        <path d="M80 270H108" />
      </g>
      <circle cx={pose.head.x} cy={pose.head.y} r="14" fill="#c7d2fe" stroke="#3730a3" strokeWidth="3" />
      <circle cx={pose.elbow.x} cy={pose.elbow.y} r="5" fill="#a5b4fc" />
      <path d="M210 96V116" stroke="#3730a3" strokeWidth="7" strokeLinecap="round" />
    </svg>
    <p className="text-xs">{progress < .5 ? '벽 쪽으로 천천히 내려가는 구간' : '벽을 밀어 시작 자세로 돌아오는 구간'}</p>
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <button type="button" className="rounded-lg bg-indigo-800 px-3 py-2 text-white" onClick={() => { if (position.current >= 1) { position.current = 0; setProgress(0); } setPlaying(value => !value); }}>{playing ? '일시정지' : '재생'}</button>
      <label><input type="checkbox" checked={loop} onChange={event => setLoop(event.target.checked)} /> 반복</label>
      <label><input type="checkbox" checked={slow} onChange={event => setSlow(event.target.checked)} /> 느리게 (0.5배)</label>
    </div>
    <label className="mt-3 block text-xs">동작 위치 (조절하면 정지)<input aria-label="동작 위치" className="block w-full" type="range" min="0" max="1" step="0.01" value={progress} onChange={event => seek(Number(event.target.value))} /></label>
    <div className="mt-2 flex flex-wrap gap-3"><button type="button" className="rounded border border-indigo-300 px-2 py-1" onClick={() => seek(0)}>시작 자세 보기</button><button type="button" className="rounded border border-indigo-300 px-2 py-1" onClick={() => seek(.5)}>굽힌 자세 보기</button></div>
    <p className="mt-2 text-xs">정지 안내: 어깨 높이의 벽에 손을 대고 몸통을 곧게 유지합니다. 편안한 범위에서 팔꿈치를 굽힌 뒤 벽을 밀어 돌아옵니다. 통증이 생기면 중단하세요. 아래 자세·중단 기준도 함께 확인하세요.</p>
  </section>;
}
