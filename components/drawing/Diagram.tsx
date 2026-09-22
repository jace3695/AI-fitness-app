import { useId } from "react";
import type { Example, Help, Lesson } from "@/lib/drawing/model";

export function Diagram({ example, lesson, step, help = 3, original = false }: { example: Example; lesson?: Lesson; step?: number; help?: Help; original?: boolean }) {
  const uid = useId().replace(/:/g, "");
  const current = lesson?.steps[step ?? 0];
  const previous = new Set(lesson?.steps.slice(0, step ?? 0).filter(s => s.action === "draw").flatMap(s => s.lines));
  const active = new Set(current?.lines);
  const startOnly = current?.action === "look";
  return <svg viewBox="0 0 400 400" className="h-full w-full" role="img" aria-label={original ? example.name : `${example.name}: ${current?.text ?? "큰 모양"}`}>
    <defs><marker id={`arrow-${uid}`} markerWidth="5" markerHeight="5" refX="3.5" refY="2.5" orient="auto"><path d="M 0 0 L 5 2.5 L 0 5 Z" fill="#bd530c" /></marker></defs>
    {example.lines.map(line => {
      const visible = original ? line.group !== "guide" && line.group !== "gesture" : help === 3 ? previous.has(line.id) || (!startOnly && active.has(line.id)) : help === 2 ? line.group === "shape" : false;
      return <g key={line.id}>
        {visible && <path d={line.d} fill={line.fill === "ink" ? (original ? "#161616" : active.has(line.id) ? "#7750c4" : "#c5c1cf") : "none"} stroke={line.fill === "ink" ? "none" : original ? "#161616" : active.has(line.id) ? "#7750c4" : "#c5c1cf"} strokeWidth={original ? 3 : 3} strokeLinecap="round" strokeLinejoin="round" />}
        {!original && help > 0 && active.has(line.id) && <>
          <circle cx={line.start[0]} cy={line.start[1]} r="5" fill="#bb510c" stroke="white" strokeWidth="1.5" />
          {help === 3 && !startOnly && Math.hypot(line.direction[0] - line.start[0], line.direction[1] - line.start[1]) > 6 && <path d={`M ${line.start.join(" ")} L ${line.direction.join(" ")}`} fill="none" stroke="#bd530c" strokeWidth="2" markerEnd={`url(#arrow-${uid})`} />}
        </>}
      </g>;
    })}
  </svg>;
}
