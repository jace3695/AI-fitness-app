"use client";

import Link from "next/link";
import AuthGate from "./components/AuthGate";
import { supabase } from "./lib/supabase";

const modules = [
  { href: "/fitness", title: "운동 관리", description: "오늘 운동·기록·식단", status: "사용 가능", color: "bg-[#EDEBFF] text-[#493F96]" },
  { href: "/budget", title: "가계부", description: "지출·예산·소비 분석", status: "사용 가능", color: "bg-[#FFF0E8] text-[#985A39]" },
  { href: "/language", title: "언어 학습", description: "일본어·복습·진도", status: "사용 가능", color: "bg-[#E7F7F1] text-[#276B56]" },
  { href: "#assistant", title: "AI 비서", description: "일정·할 일·통합 브리핑", status: "구축 중", color: "bg-[#EEF3FF] text-[#355B9C]" },
] as const;

function HubHome() {
  const signOut = async () => {
    await supabase?.auth.signOut();
    window.location.reload();
  };

  return (
    <main className="min-h-dvh bg-[#F5F4FA] text-[#242231]">
      <header className="border-b border-white/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#5146A6] text-xl font-bold text-white">J</span>
            <div>
              <p className="text-xs font-bold tracking-[0.14em] text-[#766DB8]">PERSONAL AI PLATFORM</p>
              <h1 className="text-lg font-bold">Jace AI Hub</h1>
            </div>
          </div>
          <button type="button" onClick={() => void signOut()} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-600">로그아웃</button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6 sm:py-10">
        <section className="overflow-hidden rounded-[30px] bg-gradient-to-br from-[#5146A6] to-[#766DCE] p-6 text-white shadow-[0_22px_55px_rgba(81,70,166,0.22)] sm:p-9">
          <p className="text-sm font-semibold text-white/75">안녕하세요, Jace님</p>
          <h2 className="mt-2 text-3xl font-bold leading-tight sm:text-4xl">무엇을 도와드릴까요?</h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/80">운동·가계부·언어 학습과 일정을 하나의 AI 비서에서 관리하는 개인 플랫폼입니다.</p>
          <div id="assistant" className="mt-6 flex rounded-2xl bg-white/12 p-2 ring-1 ring-white/20">
            <input aria-label="AI 비서에게 요청" disabled placeholder="AI 비서 입력창은 다음 단계에서 연결됩니다" className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-white placeholder:text-white/60 outline-none" />
            <button disabled className="rounded-xl bg-white/20 px-4 py-2 text-sm font-bold text-white/75">요청</button>
          </div>
        </section>

        <section className="mt-7">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold tracking-[0.12em] text-[#766DB8]">MY APPS</p>
              <h2 className="mt-1 text-2xl font-bold">나의 앱</h2>
            </div>
            <p className="text-xs text-gray-500">한 계정으로 통합 중</p>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {modules.map((module) => (
              <Link key={module.title} href={module.href} className="rounded-3xl border border-white bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <span className={`rounded-2xl px-3 py-2 text-sm font-bold ${module.color}`}>{module.title.slice(0, 2)}</span>
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-500">{module.status}</span>
                </div>
                <h3 className="mt-5 text-xl font-bold">{module.title}</h3>
                <p className="mt-1 text-sm text-gray-500">{module.description}</p>
                <p className="mt-4 text-sm font-bold text-[#5146A6]">열기 →</p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

export default function Page() {
  return <AuthGate><HubHome /></AuthGate>;
}
