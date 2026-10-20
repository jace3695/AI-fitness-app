'use client';
import {cooldownStages,type CooldownStageId} from '../lib/cooldownMotion';
import CooldownFigure from './CooldownFigure';
import StagedMotionDemo from './StagedMotionDemo';
const renderFigure=(id:string,progress:number,label:string)=><CooldownFigure stage={id as CooldownStageId} progress={progress} label={label}/>;
export default function CooldownMotionDemo(){return <StagedMotionDemo title="기본 정리운동" intro="걷기·어깨·가슴·허벅지와 종아리 좌우·호흡의 8장면입니다. 마지막 호흡은 정지 안내입니다. 늘림 유지 시간이나 반복 처방은 포함하지 않습니다." stages={cooldownStages} renderFigure={renderFigure}/>;}
