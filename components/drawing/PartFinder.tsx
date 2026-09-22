"use client";
import { useState } from "react";
import { Diagram } from "./Diagram";
import type { Example } from "@/lib/drawing/model";

export default function PartFinder({ example, checked, onCheck, onHelp, disabled }: { example: Example; checked: string[]; onCheck: (ids: string[]) => void; onHelp: () => void; disabled?: boolean }) {
  const parts = example.parts ?? [];
  const [selected, setSelected] = useState(parts[0]?.id ?? "");
  const [hints, setHints] = useState(false);
  const [notice, setNotice] = useState("");
  const part = parts.find(p => p.id === selected);
  if (!parts.length) return null;
  function confirm() {
    if (!part || disabled) return;
    onCheck([...new Set([...checked, part.id])]);
    setNotice(`${part.label} 위치를 짚었어요. 교재의 표시 위치와 비교한 결과예요.`);
  }
  return <section className="mt-5 rounded-2xl bg-violet-50 p-4" aria-label="부위 찾아보기">
    <h3 className="font-bold">부위 찾아보기</h3>
    <p className="my-2 text-sm">이름을 고른 뒤 아래 예제에서 그 위치를 눌러요. 내 그림의 품질을 평가하는 기능은 아니에요.</p>
    <div className="flex flex-wrap gap-2">{parts.map(p => <button type="button" key={p.id} disabled={disabled} className="drawing-button" aria-pressed={selected === p.id} onClick={() => { setSelected(p.id); setNotice(""); }}>{p.label}{checked.includes(p.id) ? " · 위치 확인" : ""}</button>)}</div>
    <button type="button" className="drawing-button my-3" aria-pressed={hints} onClick={() => { if (!hints) onHelp(); setHints(!hints); }}>{hints ? "위치 도움 숨기기" : "위치 도움 보기"}</button>
    <div className="relative mx-auto aspect-square w-full max-w-sm rounded-xl bg-white" role="group" aria-label="부위 확인 예제" onClick={e => {
      if (!part || disabled || (e.target as Element).closest('button')) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width * 400, y = (e.clientY - rect.top) / rect.height * 400;
      if (Math.hypot(x-part.point[0], y-part.point[1]) <= part.radius) confirm();
      else setNotice("조금 다른 곳을 눌렀어요. 위치 도움을 켜서 이름과 표시를 함께 봐요. 실패로 기록하지 않아요.");
    }}>
      <Diagram example={example} original />
      {hints && part && <button type="button" disabled={disabled} aria-label={`${part.label} 표시 짚기`} className="absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-emerald-600 text-white shadow" style={{left:`${part.point[0]/4}%`,top:`${part.point[1]/4}%`}} onClick={confirm}>●</button>}
    </div>
    <p role="status" className="mt-2 text-sm">{notice || "키보드로 연습할 때는 위치 도움을 켜고 표시 버튼을 누를 수 있어요."}</p>
    <p className="mt-2 text-xs">위치 확인은 도움 사용 여부와 함께 스스로 돌아봐요. 이 확인만으로 진급시키지 않아요. 그림과 함께 저장돼요.</p>
  </section>;
}
