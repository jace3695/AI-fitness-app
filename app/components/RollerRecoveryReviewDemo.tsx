'use client';

import { isRollerOuterStage, rollerInformationalRecoveryStages } from '../lib/rollerOuterMotion';
import type { RollerStageId } from '../lib/rollerMotion';
import RollerFigure from './RollerFigure';
import RollerOuterFigure from './RollerOuterFigure';
import StagedMotionDemo from './StagedMotionDemo';

const renderFigure = (id: string, progress: number, label: string) => isRollerOuterStage(id)
  ? <RollerOuterFigure stage={id} progress={progress} label={label} />
  : <RollerFigure stage={id as RollerStageId} progress={progress} label={label} />;

export default function RollerRecoveryReviewDemo() {
  return <StagedMotionDemo
    title="폼롤러 회복 · 일반 동작 검토본"
    intro="기존 7장면에 외측 대퇴사두근 좌우 2장면을 새 일반 정의로 더한 9장면입니다. 원 안내의 ‘바깥 허벅지’가 이 근육을 뜻했다는 확인은 아닙니다. 기존 루틴의 시간·횟수·추천은 변경하지 않습니다. 준비·좌우 전환은 생략하며 그림의 이동량과 재생 시간은 운동 범위나 용량이 아닙니다."
    stages={rollerInformationalRecoveryStages}
    renderFigure={renderFigure}
  />;
}
