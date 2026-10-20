import { bandRowPose } from '../lib/bandRowMotion';

export default function BandRowFigure({ progress, label }: { progress: number; label: string }) {
  const pose = bandRowPose(progress);
  const points = (...keys: (keyof typeof pose)[]) => keys.map(key => `${pose[key].x},${pose[key].y}`).join(' ');
  return <svg viewBox="0 0 300 300" role="img" aria-label={label} className="mx-auto w-full max-w-72">
    <path d="M35 278H280" stroke="#94a3b8" strokeWidth="3" />
    <path d={`M${pose.hand.x} ${pose.hand.y}L266 141`} stroke="#b45309" strokeWidth="4" />
    <circle cx="266" cy="141" r="7" fill="#fff" stroke="#92400e" strokeWidth="3" />
    <text x="278" y="120" textAnchor="end" fill="#78350f" fontSize="11">고정점(개념)</text>
    <path d="M218 167H247L241 163M247 167L241 171" fill="none" stroke="#92400e" strokeWidth="2" />
    <text x="262" y="185" textAnchor="end" fill="#78350f" fontSize="11">밴드가 당기는 쪽</text>
    <polyline points={points('hip', 'farKnee', 'farAnkle', 'farToe')} fill="none" stroke="#818cf8" strokeWidth="9" strokeLinecap="round" />
    <g fill="none" stroke="#3730a3" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round">
      <polyline points={points('head', 'shoulder', 'hip', 'knee', 'ankle', 'toe')} />
      <polyline points={points('shoulder', 'elbow', 'hand')} />
    </g>
    <circle cx="120" cy="73" r="15" fill="#c7d2fe" stroke="#3730a3" strokeWidth="3" />
    <circle cx={pose.elbow.x} cy={pose.elbow.y} r="5" fill="#fbbf24" />
    <text x="20" y="295" fill="#475569" fontSize="11">한쪽 팔의 경로 · 밴드 강도/설치 예시 아님</text>
  </svg>;
}
