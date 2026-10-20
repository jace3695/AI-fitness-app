import { lowerBodyExercisePose, type LowerBodyMotionId } from '../lib/lowerBodyExerciseMotion';

export default function LowerBodyExerciseFigure({ id, progress, label }: { id: LowerBodyMotionId; progress: number; label: string }) {
  const pose = lowerBodyExercisePose(id, progress);
  const points = (...names: (keyof typeof pose)[]) => names.map(name => `${pose[name].x},${pose[name].y}`).join(' ');
  const curl = id === 'supported-hamstring-curl';
  return <svg viewBox="0 0 300 300" role="img" aria-label={label} className="mx-auto w-full max-w-72">
    <path d="M35 278H265" stroke="#94a3b8" strokeWidth="3" />
    {curl && <g fill="none" stroke="#64748b" strokeWidth="4"><path d="M185 135H235M190 135V275M230 135V275M190 202H230" /><text x="232" y="122" textAnchor="end" fill="#475569" stroke="none" fontSize="12">지지대</text></g>}
    <g fill="none" stroke="#818cf8" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round">
      <polyline points={points('farShoulder', 'farHip', 'farKnee', 'farAnkle', 'farToe')} />
      <polyline points={points('farShoulder', 'farElbow', 'farHand')} />
    </g>
    <g fill="none" stroke="#3730a3" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round">
      <polyline points={points('head', 'shoulder', 'hip', 'knee', 'ankle', 'toe')} />
      <polyline points={points('shoulder', 'elbow', 'hand')} />
    </g>
    <circle cx={pose.head.x} cy={pose.head.y} r="15" fill="#c7d2fe" stroke="#3730a3" strokeWidth="3" />
    <circle cx={pose.knee.x} cy={pose.knee.y} r="5" fill="#fbbf24" />
  </svg>;
}
