"use client";

import AuthGate from "../components/AuthGate";
import DietView from "../components/DietView";
import CloudSyncPanel from "../components/CloudSyncPanel";

function DietApp() {
  return (
    <main className="min-h-dvh bg-[#F6F7FB] pb-28">
      <header className="border-b border-gray-100 bg-white/95 px-4 py-4 shadow-sm">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs font-bold tracking-[0.14em] text-emerald-700">JACE HEALTH</p>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">재민님의 식단</h1>
          <p className="mt-1 text-xs text-gray-500">운동 앱과 건강 기록을 공유하는 독립 식단 앱</p>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6"><DietView /><div className="mt-5"><CloudSyncPanel /></div></div>
    </main>
  );
}

export default function Page() { return <AuthGate><DietApp /></AuthGate>; }
