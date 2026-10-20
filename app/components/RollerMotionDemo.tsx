'use client';
import {rollerPrepStages,rollerRecoveryStages,type RollerStageId} from '../lib/rollerMotion';
import type {RoutineStageId} from '../lib/routineMotion';
import RoutineFigure from './RoutineFigure';
import RollerFigure from './RollerFigure';
import StagedMotionDemo from './StagedMotionDemo';
const renderFigure=(id:string,progress:number,label:string)=>id.startsWith('outer-')?<p role="note" className="my-4 rounded border border-amber-300 bg-amber-50 p-3">이 부위는 움직이는 시범을 제공하지 않습니다. 다른 부위의 검증 완료와 회복 루틴 전체 완료는 구별합니다.</p>:id.startsWith('warmup-')?<RoutineFigure stage={id.slice(7) as RoutineStageId} progress={progress} label={label}/>:<RollerFigure stage={id as RollerStageId} progress={progress} label={label}/>;
export default function RollerMotionDemo({recovery=false}:{recovery?:boolean}){return <StagedMotionDemo key={String(recovery)} title={recovery?'폼롤러 회복 · 부분 시범':'폼롤러 준비'} intro={recovery?'전체 9단계 중 7개 부위 장면만 구현했습니다. 바깥 허벅지 좌우 2단계는 시범 보류이며 전체 완료가 아닙니다.':'부위별 좌우 7장면과 기본 몸풀기 7장면입니다. 바닥에 안정적으로 준비한 뒤 해당 장면을 선택하세요. 압력·시간·반복 횟수 처방은 포함하지 않습니다.'} stages={recovery?rollerRecoveryStages:rollerPrepStages} renderFigure={renderFigure}/>;}
