"use client";

import Link from "next/link";
import AuthGate from "./components/AuthGate";
import { supabase } from "./lib/supabase";
import { AppIcon } from "./components/AppIdentity";

const modules = [
  { href: "/assistant", title: "제이스비서", description: "일정·할 일·통합 브리핑", status: "메인", color: "bg-[#EEF3FF] text-[#355B9C]" },
  { href: "/budget", title: "가계부", description: "지출·예산·소비 분석", status: "사용 가능", color: "bg-[#FFF0E8] text-[#985A39]" },
  { href: "/fitness", title: "운동 관리", description: "오늘 운동·운동 기록", status: "사용 가능", color: "bg-[#EDEBFF] text-[#493F96]" },
  { href: "/diet", title: "식단 관리", description: "식사·단백질·수분·공복", status: "운동 연동", color: "bg-[#E7F7F1] text-[#276B56]" },
  { href: "/language", title: "언어 학습", description: "일본어·복습·진도", status: "사용 가능", color: "bg-[#E7F7F1] text-[#276B56]" },
  { href: "/calendar", title: "통합 달력", description: "할 일·운동·식단·언어", status: "통합", color: "bg-[#FFF5D6] text-[#805D13]" },
  { href: "/settings", title: "통합 설정", description: "비밀번호·PIN·Face ID", status: "공통", color: "bg-[#F1EFFF] text-[#5146A6]" },
] as const;

function HubHome() {
  const signOut = async () => {
    await supabase?.auth.signOut();
    window.location.reload();
  };

  return (
    <main className="min-h-dvh bg-[#F5F4FA] pb-24 text-[#242231] md:pb-0">
      <header className="border-b border-white/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <AppIcon kind="assistant" className="h-11 w-11" />
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
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/80">오늘 할 일부터 소비·운동·언어 복습까지 AI 비서 한 화면에서 확인하세요.</p>
          <Link href="/assistant" className="mt-6 flex items-center justify-between rounded-2xl bg-white/12 p-4 text-sm font-semibold ring-1 ring-white/20 transition hover:bg-white/20"><span>제이스비서에서 오늘 할 일을 정리하세요</span><span className="font-bold">열기 →</span></Link>
        </section>

        <section className="mt-7">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold tracking-[0.12em] text-[#766DB8]">MY APPS</p>
              <h2 className="mt-1 text-2xl font-bold">나의 앱</h2>
            </div>
            <p className="text-xs text-gray-500">한 계정으로 연결됨</p>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {modules.map((module) => (
              <Link key={module.title} href={module.href} className="rounded-3xl border border-white bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <AppIcon kind={module.href === "/assistant" ? "assistant" : module.href === "/budget" ? "budget" : module.href === "/fitness" ? "fitness" : module.href === "/diet" ? "diet" : module.href === "/language" ? "language" : module.href === "/calendar" ? "calendar" : "settings"} />
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
