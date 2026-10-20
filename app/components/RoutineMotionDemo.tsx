'use client';
import {warmupStages,type RoutineStageId} from '../lib/routineMotion';
import RoutineFigure from './RoutineFigure';
import StagedMotionDemo from './StagedMotionDemo';
const renderFigure=(id:string,progress:number,label:string)=><RoutineFigure stage={id as RoutineStageId} progress={progress} label={label}/>;
export default function RoutineMotionDemo(){return <StagedMotionDemo title="기본 몸풀기" intro="기존 6개 안내 항목을 따르며 발목은 좌우를 나눠 7장면으로 표시합니다." stages={warmupStages} renderFigure={renderFigure}/>;}
