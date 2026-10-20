'use client';

import { useId } from 'react';
import { assistedBarGeometry as bar, preparationPoseId, preparationPoses, sliderReadyGeometry as slider, type PosePoint } from '../lib/preparationPose';

const line = (a: PosePoint, b: PosePoint) => `${a.x},${a.y} ${b.x},${b.y}`;

/** Static catalog preparation poses. No playback state or animation timers. */
export default function PreparationPoseDemo({ exerciseId }: { exerciseId?: string }) {
  const titleId = useId(), descriptionId = useId();
  const id = preparationPoseId(exerciseId);
  if (!id) return null;
  const guide = preparationPoses[id];
  const isSlider = id === 'ab-slider-ready-position';
  return <section className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-slate-900" aria-label={guide.name + ' 정지 도해'}>
    <p className="font-semibold">{guide.name} · 자체 제작 정지 도해</p>
    <p className="mt-2">{guide.scope}</p>
    <svg className="mt-3 w-full" viewBox={isSlider ? '0 0 300 260' : '0 0 300 310'} role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
      <title id={titleId}>{guide.name}</title>
      <desc id={descriptionId}>{isSlider ? '옆모습. 무릎과 발을 바닥에 대고 양손은 슬라이더 손잡이를 잡은 채 정지합니다.' : '정면. 양손은 바를 잡고 양발은 바닥에 닿아 체중을 지지하는 준비 자세입니다.'}</desc>
      {isSlider ? <>
        <path d={`M25 ${slider.floor}H275`} stroke="#94a3b8" strokeWidth="2"/>
        <path d="M87 207H132" stroke="#cbd5e1" strokeWidth="8" strokeLinecap="round"/>
        <circle cx={slider.wheel.x} cy={slider.wheel.y} r={slider.wheelRadius} fill="#c7d2fe" stroke="#4338ca" strokeWidth="3"/>
        <g fill="none" stroke="#4338ca" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round">
          <polyline points={[slider.toe, slider.ankle, slider.knee, slider.hip, slider.shoulder].map(p=>`${p.x},${p.y}`).join(' ')}/>
          <polyline points={[slider.shoulder, slider.elbow, slider.hand].map(p=>`${p.x},${p.y}`).join(' ')}/>
          <polyline points={line(slider.shoulder,{x:190,y:136})}/>
        </g>
        <circle cx={slider.head.x} cy={slider.head.y} r="14" fill="#c7d2fe" stroke="#4338ca" strokeWidth="3"/>
        <path d="M169 193.5H189" stroke="#f97316" strokeWidth="6" strokeLinecap="round"/>
        <text x="150" y="240" textAnchor="middle" fontSize="12" fill="#334155">정지 · 양손은 겹쳐 보이는 손잡이에</text>
      </> : <>
        <path d="M67 34H233" stroke="#64748b" strokeWidth="7" strokeLinecap="round"/>
        <path d={`M38 ${bar.floor}H262`} stroke="#94a3b8" strokeWidth="2"/>
        <g fill="none" stroke="#4338ca" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round">
          <polyline points={[bar.leftHand,bar.leftElbow,bar.leftShoulder,bar.rightShoulder,bar.rightElbow,bar.rightHand].map(p=>`${p.x},${p.y}`).join(' ')}/>
          <polyline points={line({x:150,y:120},bar.hip)}/>
          <polyline points={[bar.leftToe,bar.leftAnkle,bar.leftKnee,bar.hip,bar.rightKnee,bar.rightAnkle,bar.rightToe].map(p=>`${p.x},${p.y}`).join(' ')}/>
        </g>
        <circle cx={bar.head.x} cy={bar.head.y} r="15" fill="#c7d2fe" stroke="#4338ca" strokeWidth="3"/>
        <path d="M115 263H137M163 263H185" stroke="#f97316" strokeWidth="3"/>
        <text x="150" y="293" textAnchor="middle" fontSize="12" fill="#334155">양발 바닥 지지 · 설치 구조는 생략</text>
      </>}
    </svg>
    <p className="mt-2 font-semibold">자세 확인 순서</p>
    <ol className="list-decimal space-y-1 pl-5">{guide.steps.map(step=><li key={step}>{step}</li>)}</ol>
    <p className="mt-3">{guide.caution}</p>
    <p className="mt-3">동작 이해를 위한 단순 도해이며 의료 처방이 아닙니다. 전문가 자세 검수를 받지 않았고 허리 질환에 안전하다고 보장하지 않습니다. 기존 자세 안내와 중단 기준을 우선하세요. 유지 시간·횟수·다음 단계는 지정하지 않습니다.</p>
  </section>;
}
