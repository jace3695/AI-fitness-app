import { alternatingExercisePose, type AlternatingMotionId } from '../lib/alternatingExerciseMotion';
export default function AlternatingExerciseFigure({ id, progress, label }: { id: AlternatingMotionId; progress: number; label: string }) {
  const p = alternatingExercisePose(id, progress);
  const points = (...keys: (keyof typeof p)[]) => keys.map(key => `${p[key].x},${p[key].y}`).join(' ');
  const bird = id === 'bird-dog';
  return <svg viewBox="0 0 300 300" role="img" aria-label={label} className="mx-auto w-full max-w-72">
    <path d={bird ? 'M5 203H265' : 'M35 278H265'} stroke="#94a3b8" strokeWidth="3" />
    <g fill="none" stroke="#818cf8" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round">
      <polyline points={points('farShoulder', 'farHip', 'farKnee', 'farAnkle', 'farToe')} />
      <polyline points={points('farShoulder', 'farElbow', 'farHand')} />
    </g>
    <g fill="none" stroke="#3730a3" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round">
      <polyline points={points('head', 'shoulder', 'hip', 'knee', 'ankle', 'toe')} />
      <polyline points={points('shoulder', 'elbow', 'hand')} />
    </g>
    <circle cx={p.head.x} cy={p.head.y} r="15" fill="#c7d2fe" stroke="#3730a3" strokeWidth="3" />
    <text x="150" y="295" textAnchor="middle" fontSize="11" fill="#475569">보라: 오른쪽 · 연보라: 왼쪽</text>
  </svg>;
}
