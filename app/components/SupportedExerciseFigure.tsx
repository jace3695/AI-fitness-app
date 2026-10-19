import { supportedExercisePose, type SupportedMotionId } from '../lib/supportedExerciseMotion';

/** Original inline SVG; no external assets, animation engine, or network access. */
export default function SupportedExerciseFigure({ id, progress, label }: { id: SupportedMotionId; progress: number; label: string }) {
  const pose = supportedExercisePose(id, progress);
  const points = (...names: (keyof typeof pose)[]) => names.map(name => `${pose[name].x},${pose[name].y}`).join(' ');
  const calf = id === 'supported-calf-raise';
  return <svg viewBox="0 0 300 300" role="img" aria-label={label} className="mx-auto w-full max-w-72">
    <path d="M35 278H265" stroke="#94a3b8" strokeWidth="3" />
    <g fill="none" stroke="#64748b" strokeWidth="4" strokeLinecap="round">
      <path d={calf ? 'M180 135H230M185 135V275M225 135V275M185 202H225' : 'M65 145H210M70 145V275M205 145V275'} />
    </g>
    <g fill="none" stroke="#818cf8" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round">
      <polyline points={points('farShoulder', 'farHip', 'farKnee', 'farAnkle', 'farToe')} />
      <polyline points={points('farShoulder', 'farElbow', 'farHand')} />
    </g>
    <g fill="none" stroke="#3730a3" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round">
      {calf ? <polyline points={points('head', 'shoulder', 'hip', 'knee', 'ankle', 'toe')} /> : <>
        <polyline points={points('farShoulder', 'shoulder', 'hip', 'farHip', 'farShoulder')} />
        <path d="M125 64V96" />
        <polyline points={points('hip', 'knee', 'ankle', 'toe')} />
      </>}
      <polyline points={points('shoulder', 'elbow', 'hand')} />
    </g>
    <circle cx={pose.head.x} cy={pose.head.y} r="15" fill="#c7d2fe" stroke="#3730a3" strokeWidth="3" />
    <circle cx={calf ? pose.ankle.x : pose.hip.x} cy={calf ? pose.ankle.y : pose.hip.y} r="5" fill="#fbbf24" />
    <text x="230" y="123" textAnchor="end" fontSize="12" fill="#475569">지지대</text>
  </svg>;
}
