"use client";

import AuthGate from "../components/AuthGate";
import DietView from "../components/DietView";
import CloudSyncPanel from "../components/CloudSyncPanel";
import AppIdentity from "../components/AppIdentity";

function DietApp() {
  return (
    <main className="min-h-dvh bg-[#F6F7FB]">
      <header className="app-module-header">
        <div className="app-module-header-inner"><AppIdentity kind="diet" title="재민님의 식단" subtitle="운동 기록과 연동되는 독립 식단 앱" /></div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6"><DietView /><div className="mt-5"><CloudSyncPanel /></div></div>
    </main>
  );
}

export default function Page() { return <AuthGate><DietApp /></AuthGate>; }
