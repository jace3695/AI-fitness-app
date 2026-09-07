"use client";

import YeoniPreferencesPanel from "@/components/YeoniPreferencesPanel";
import AuthGate from "../components/AuthGate";
import AccountPasswordPanel from "../components/AccountPasswordPanel";
import DevicePinPanel from "../components/DevicePinPanel";
import AppIdentity from "../components/AppIdentity";
import AiBudgetPanel from "../components/AiBudgetPanel";
import Link from "next/link";
import { APP_RESET_INFO, RECORD_RESET_APPS } from "../data/appRecordReset";

function SettingsPage() {
  return (
    <main className="min-h-dvh bg-[#F6F7FB] text-[#242231]">
      <header className="app-module-header"><div className="app-module-header-inner"><AppIdentity kind="settings" title="통합 설정" subtitle="캐릭터·계정·기기 보안" /></div></header>
      <div className="mx-auto max-w-3xl px-4 py-7 sm:px-6 sm:py-10">
        <p className="text-sm leading-6 text-gray-500">계정 보안과 기기 잠금은 여기에서 한 번만 설정하면 가계부·운동·식단·언어 앱에 함께 적용됩니다.</p>
        <div className="mt-6 grid gap-4">
          <YeoniPreferencesPanel />
          <AiBudgetPanel />
          <section className="rounded-3xl bg-white p-5 shadow-sm"><h2 className="text-xl font-bold">앱별 기록 관리</h2><p className="mt-2 text-sm leading-6 text-gray-600">초기화할 앱의 설정에서 지워지는 기록을 확인하세요. 통합 달력은 각 앱의 원본 기록을 함께 보여줍니다.</p><div className="mt-4 grid gap-2 sm:grid-cols-2">{RECORD_RESET_APPS.map(app => <Link key={app} href={APP_RESET_INFO[app].href} className="min-h-12 rounded-xl bg-gray-50 px-4 py-3 text-sm font-bold">{APP_RESET_INFO[app].label} 기록 관리 →</Link>)}</div><p className="mt-3 text-xs text-gray-500">가계부는 앱 안의 설정 메뉴에서 초기화할 수 있어요.</p></section>
          <AccountPasswordPanel />
          <DevicePinPanel />
          <section className="rounded-3xl bg-[#EEEDFE] p-5 text-sm leading-6 text-[#3C3489]">
            <b>Face ID 안내</b><br />iPhone에서는 Safari로 홈 화면에 추가한 뒤 생체인증을 설정하세요. 얼굴 정보는 앱이나 서버에 저장되지 않고 기기에서만 확인됩니다.
          </section>
        </div>
      </div>
    </main>
  );
}

export default function Page() { return <AuthGate><SettingsPage /></AuthGate>; }
