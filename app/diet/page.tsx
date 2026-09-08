"use client";

import AppCompanion from "@/components/AppCompanion";
import AuthGate from "../components/AuthGate";
import DietView from "../components/DietView";
import CloudSyncPanel from "../components/CloudSyncPanel";
import AppIdentity from "../components/AppIdentity";
import Link from "next/link";

function DietApp() {
  return (
    <main className="min-h-dvh bg-yeoni-bg">
      <header className="app-module-header">
        <div className="app-module-header-inner"><AppIdentity kind="diet" title="재민님의 식단" subtitle="운동 기록과 연동되는 독립 식단 앱" /><Link href="/diet/settings" className="inline-flex min-h-11 shrink-0 items-center px-3 text-sm font-bold">설정</Link></div>
      </header>
      <div className="yeoni-page-content"><AppCompanion home>오늘 먹은 음식과 물, 식사 시간을 기록해 봐요. 외식이나 여행 일정도 함께 남길 수 있어요.</AppCompanion><DietView /><div className="mt-5"><CloudSyncPanel /></div></div>
    </main>
  );
}

export default function Page() { return <AuthGate><DietApp /></AuthGate>; }
