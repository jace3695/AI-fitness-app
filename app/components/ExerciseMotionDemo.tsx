'use client';

import { useEffect, useRef, useState } from 'react';
import { useMotionDisclosurePause } from '../../hooks/useMotionDisclosurePause';
import { advanceMotion, clampProgress, exerciseMotionPose, exerciseMotions, motionId, type MotionId } from '../lib/exerciseMotion';
import { supportedMotionId, supportedExerciseMotions } from '../lib/supportedExerciseMotion';
import SupportedExerciseFigure from './SupportedExerciseFigure';
import { lowerBodyExerciseMotions, lowerBodyMotionId } from '../lib/lowerBodyExerciseMotion';
import LowerBodyExerciseFigure from './LowerBodyExerciseFigure';
import { alternatingExerciseMotions, alternatingMotionId, alternatingPhase } from '../lib/alternatingExerciseMotion';
import AlternatingExerciseFigure from './AlternatingExerciseFigure';
import { bandRowGuide, bandRowMotionId } from '../lib/bandRowMotion';
import BandRowFigure from './BandRowFigure';
import { floorPressGuide, floorPressMotionId } from '../lib/floorPressMotion';
import FloorPressFigure from './FloorPressFigure';
import { bandRotationGuide, bandRotationMotionId } from '../lib/bandRotationMotion';
import BandRotationFigure from './BandRotationFigure';
import { pullApartGuide, pullApartMotionId } from '../lib/pullApartMotion';
import PullApartFigure from './PullApartFigure';
import { pallofGuide, pallofMotionId } from '../lib/pallofMotion';
import PallofFigure from './PallofFigure';
import { gobletGuide, gobletMotionId } from '../lib/gobletMotion';
import GobletFigure from './GobletFigure';
import { loopWalkGuides, loopWalkMotionId, loopWalkPhase } from '../lib/loopWalkMotion';
import LoopWalkFigure from './LoopWalkFigure';
import { supportedRowGuide, supportedRowMotionId } from '../lib/supportedRowMotion';
import SupportedRowFigure from './SupportedRowFigure';
import { latPulldownGuide, latPulldownMotionId } from '../lib/latPulldownMotion';
import LatPulldownFigure from './LatPulldownFigure';
import { facePullGuide, facePullMotionId } from '../lib/facePullMotion';
import FacePullFigure from './FacePullFigure';
import { catCowGuide, catCowMotionId, catCowPhase } from '../lib/catCowMotion';
import CatCowFigure from './CatCowFigure';
import { kneePlankGuide, kneePlankMotionId } from '../lib/kneePlankMotion';
import KneePlankFigure from './KneePlankFigure';
import { pelvicTiltGuide, pelvicTiltMotionId } from '../lib/pelvicTiltMotion';
import PelvicTiltFigure from './PelvicTiltFigure';
import { assistedBarGuide, assistedBarMotionId } from '../lib/assistedBarMotion';
import AssistedBarFigure from './AssistedBarFigure';
import { routineMotionId } from '../lib/routineMotion';
import RollerMotionDemo from './RollerMotionDemo';
import CooldownMotionDemo from './CooldownMotionDemo';
import RoutineMotionDemo from './RoutineMotionDemo';

export default function ExerciseMotionDemo({ exerciseId }: { exerciseId?: string }) {
  // Preserve incomplete review assets without exposing them as app demonstrations.
  if (exerciseId === 'dead-bug' || exerciseId === 'foam-roller-recovery' || exerciseId === 'ab-slider-ready-position') return null;
  if (exerciseId === 'foam-roller-prep') return <RollerMotionDemo />;
  if (exerciseId === 'basic-cooldown') return <CooldownMotionDemo />;
  if (routineMotionId(exerciseId)) return <RoutineMotionDemo />;
  const id = motionId(exerciseId);
  return id ? <MotionPlayer key={id} id={id} /> : null;
}

function MotionPlayer({ id }: { id: MotionId }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loop, setLoop] = useState(false);
  const [slow, setSlow] = useState(false);
  const [reduced, setReduced] = useState(false);
  const position = useRef(0);
  const panel = useRef<HTMLElement>(null);
  useMotionDisclosurePause(panel, setPlaying);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const preference = () => { setReduced(query.matches); if (query.matches) setPlaying(false); };
    const visibility = () => { if (document.hidden) setPlaying(false); };
    preference();
    query.addEventListener('change', preference);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      query.removeEventListener('change', preference); document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useEffect(() => {
    if (!playing || reduced) return;
    let frame = 0;
    let last: number | undefined;
    const tick = (now: number) => {
      if (document.hidden) { setPlaying(false); return; }
      const next = advanceMotion(position.current, last === undefined ? 0 : now - last, slow, loop);
      last = now;
      position.current = next.progress;
      setProgress(next.progress);
      if (next.ended) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, reduced, slow, loop]);
  const seek = (p: number) => { setPlaying(false); position.current = clampProgress(p); setProgress(position.current); };
  const supportedId = supportedMotionId(id);
  const lowerId = lowerBodyMotionId(id);
  const alternatingId = alternatingMotionId(id);
  const bandId = bandRowMotionId(id);
  const floorId = floorPressMotionId(id);
  const rotationId = bandRotationMotionId(id);
  const pullId = pullApartMotionId(id);
  const pallofId = pallofMotionId(id);
  const gobletId = gobletMotionId(id);
  const walkId = loopWalkMotionId(id);
  const supportedRowId = supportedRowMotionId(id);
  const latId = latPulldownMotionId(id);
  const faceId = facePullMotionId(id);
  const catId = catCowMotionId(id);
  const kneeId = kneePlankMotionId(id);
  const pelvicId = pelvicTiltMotionId(id);
  const assistedBarId = assistedBarMotionId(id);
  const supportedGuide = supportedId ? supportedExerciseMotions[supportedId] : lowerId ? lowerBodyExerciseMotions[lowerId] : alternatingId ? alternatingExerciseMotions[alternatingId] : bandId ? bandRowGuide : floorId ? floorPressGuide : rotationId ? bandRotationGuide : pullId ? pullApartGuide : pallofId ? pallofGuide : gobletId ? gobletGuide : walkId ? loopWalkGuides[walkId] : supportedRowId ? supportedRowGuide : latId ? latPulldownGuide : faceId ? facePullGuide : catId ? catCowGuide : kneeId ? kneePlankGuide : pelvicId ? pelvicTiltGuide : assistedBarId ? assistedBarGuide : null;
  const pose = exerciseMotionPose(id === 'seated-knee-extension' ? id : 'light-dumbbell-curl', progress);
  const points = (...names: (keyof typeof pose)[]) => names.map(name => `${pose[name].x},${pose[name].y}`).join(' ');
  const asset = exerciseMotions[id];
  const phase = catId ? catCowPhase(progress) : walkId ? loopWalkPhase(walkId, progress) : alternatingId ? alternatingPhase(alternatingId, progress) : progress < .5 ? asset.outward : asset.returning;
  const source = lowerId ? lowerBodyExerciseMotions[lowerId] : alternatingId ? alternatingExerciseMotions[alternatingId] : bandId ? bandRowGuide : floorId ? floorPressGuide : rotationId ? bandRotationGuide : pullId ? pullApartGuide : pallofId ? pallofGuide : gobletId ? gobletGuide : walkId ? loopWalkGuides[walkId] : supportedRowId ? supportedRowGuide : latId ? latPulldownGuide : faceId ? facePullGuide : catId ? catCowGuide : kneeId ? kneePlankGuide : pelvicId ? pelvicTiltGuide : assistedBarId ? assistedBarGuide : null;
  const seated = id === 'seated-knee-extension';
  return <section ref={panel} aria-label={`${asset.name} 자체 시범`} className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-slate-800">
    <p className="font-bold">{asset.name} · 자체 제작 {supportedGuide?.view || '측면'} 도해</p>
    <p className="mt-1 text-xs">동작 이해를 위한 단순 도해이며 의료 처방이 아닙니다. 전문가의 자세 검증을 받지 않았고, 허리 질환에 안전하다고 보장하지 않습니다.</p>
    {assistedBarId ? <AssistedBarFigure progress={progress} label={`${asset.name}: ${phase}`} /> : pelvicId ? <PelvicTiltFigure progress={progress} label={`${asset.name}: ${phase}`} /> : kneeId ? <KneePlankFigure progress={progress} label={`${asset.name}: ${phase}`} /> : catId ? <CatCowFigure progress={progress} label={`${asset.name}: ${phase}`} /> : faceId ? <FacePullFigure progress={progress} label={`${asset.name}: ${phase}`} /> : latId ? <LatPulldownFigure progress={progress} label={`${asset.name}: ${phase}`} /> : supportedRowId ? <SupportedRowFigure progress={progress} label={`${asset.name}: ${phase}`} /> : walkId ? <LoopWalkFigure id={walkId} progress={progress} label={`${asset.name}: ${phase}`} /> : gobletId ? <GobletFigure progress={progress} label={`${asset.name}: ${phase}`} /> : pallofId ? <PallofFigure progress={progress} label={`${asset.name}: ${phase}`} /> : pullId ? <PullApartFigure progress={progress} label={`${asset.name}: ${phase}`} /> : rotationId ? <BandRotationFigure progress={progress} label={`${asset.name}: ${phase}`} /> : floorId ? <FloorPressFigure progress={progress} label={`${asset.name}: ${phase}`} /> : bandId ? <BandRowFigure progress={progress} label={`${asset.name}: ${phase}`} /> : alternatingId ? <AlternatingExerciseFigure id={alternatingId} progress={progress} label={`${asset.name}: ${phase}`} /> : lowerId ? <LowerBodyExerciseFigure id={lowerId} progress={progress} label={`${asset.name}: ${phase}`} /> : supportedId ? <SupportedExerciseFigure id={supportedId} progress={progress} label={`${asset.name}: ${phase}`} /> : <svg viewBox="0 0 300 300" role="img" aria-label={`${asset.name}: ${phase}`} className="mx-auto w-full max-w-72">
      <path d={seated ? 'M40 244H260' : 'M40 280H260'} stroke="#94a3b8" strokeWidth="3" />
      {seated && <g fill="none" stroke="#64748b" strokeWidth="5"><path d="M87 110V195H165M93 195V242M157 195V242" /><path d="M115 183L156 183L151 238L175 238" stroke="#a5b4fc" strokeWidth="9" /></g>}
      {!seated && <path d="M110 175L92 222L92 274H114" fill="none" stroke="#a5b4fc" strokeWidth="9" strokeLinecap="round" />}
      <g fill="none" stroke="#3730a3" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round">
        <polyline points={points('head', 'shoulder', 'hip', 'knee', 'ankle')} />
        <polyline points={points('shoulder', 'elbow', 'hand')} />
        <path d={`M${pose.ankle.x} ${pose.ankle.y}h20`} />
      </g>
      <circle cx={pose.head.x} cy={pose.head.y} r="15" fill="#c7d2fe" stroke="#3730a3" strokeWidth="3" />
      <circle cx={seated ? pose.knee.x : pose.elbow.x} cy={seated ? pose.knee.y : pose.elbow.y} r="5" fill="#fbbf24" />
      {!seated && <g stroke="#475569" strokeWidth="6" strokeLinecap="round"><path d={`M${pose.hand.x - 12} ${pose.hand.y}h24M${pose.hand.x - 12} ${pose.hand.y - 7}v14M${pose.hand.x + 12} ${pose.hand.y - 7}v14`} /></g>}
    </svg>}
    <p>{phase}</p>
    <p className="mt-1 text-xs">{asset.limitation}</p>
    {supportedGuide && <div className="mt-3 text-xs">
      <p className="font-bold">쉽게 따라 읽는 순서</p>
      <ol className="list-decimal space-y-1 pl-5">{supportedGuide.steps.map(step => <li key={step}>{step}</li>)}</ol>
      <p className="mt-2">{supportedGuide.caution}</p>
      <p className="mt-2">현재 상태에 맞춘 추천이 아닙니다. 허리 디스크나 동작 중 통증 이력이 있다면 적용 여부를 담당 전문가와 확인하세요. 횟수·중량은 지정하지 않습니다.</p>
      {assistedBarId ? <p>기존 턱걸이 준비 안내의 발 보조 범위만 표시합니다.</p> : <a className="underline" href={source?.sourceUrl || 'https://www.nhs.uk/live-well/exercise/strength-exercises/'} target="_blank" rel="noopener noreferrer">동작 원리 참고: {source?.sourceTitle || 'NHS Strength exercises'}</a>}
    </div>}
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button type="button" disabled={reduced} aria-pressed={playing} className="min-h-11 min-w-11 rounded bg-indigo-800 px-3 py-2 text-white disabled:opacity-50" onClick={() => { if (position.current >= 1) { position.current = 0; setProgress(0); } setPlaying(v => !v); }}>{playing ? '일시정지' : '재생'}</button>
      <label className="inline-flex min-h-11 items-center gap-2 px-2"><input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} /> 반복</label>
      <label className="inline-flex min-h-11 items-center gap-2 px-2"><input type="checkbox" checked={slow} onChange={e => setSlow(e.target.checked)} /> 느리게 (0.5배)</label>
    </div>
    {reduced && <p className="mt-2 text-xs">동작 줄이기 설정에 따라 정지 자세를 표시합니다. 슬라이더로 자세를 확인하세요.</p>}
    <label className="mt-3 block">동작 위치 (조절하면 정지)<input aria-label={`${asset.name} 동작 위치`} className="block min-h-11 w-full" type="range" min="0" max="1" step="0.01" value={progress} onChange={e => seek(Number(e.target.value))} /></label>
    <div className="mt-2 flex flex-wrap gap-3"><button type="button" className="min-h-11 rounded border border-indigo-300 px-2 py-1" onClick={() => seek(0)}>시작 자세 보기</button>{(catId || alternatingId) ? <><button type="button" className="min-h-11 rounded border border-indigo-300 px-2 py-1" onClick={() => seek(.25)}>{catId ? '가슴 열기 보기' : '첫쪽 자세 보기'}</button><button type="button" className="min-h-11 rounded border border-indigo-300 px-2 py-1" onClick={() => seek(.75)}>{catId ? '등 둥글게 보기' : '반대쪽 자세 보기'}</button></> : <button type="button" className="min-h-11 rounded border border-indigo-300 px-2 py-1" onClick={() => seek(.5)}>{assistedBarId ? '어깨 준비 자세 보기' : pelvicId ? '골반 말기 보기' : walkId ? '이동 뒤 자세 보기' : (supportedRowId || latId || faceId) ? '당긴 자세 보기' : id === 'band-pallof-press' ? '앞으로 민 자세 보기' : id === 'band-pull-apart' ? '벌린 자세 보기' : id === 'band-external-rotation-at-side' ? '회전한 자세 보기' : id === 'band-row' ? '당긴 자세 보기' : (id === 'bodyweight-squat' || id === 'dumbbell-goblet-squat') ? '내려간 자세 보기' : '올린 자세 보기'}</button>}</div>
    <p className="mt-2 text-xs">통증이나 저림이 생기면 중단하세요. 기존 자세 안내·중단 기준이 우선합니다. 정지 화면과 움직임의 크기를 따라 무리하게 범위를 늘리지 마세요.</p>
  </section>;
}
