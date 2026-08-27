"use client";

import AuthGate from "../components/AuthGate";
import AccountPasswordPanel from "../components/AccountPasswordPanel";
import DevicePinPanel from "../components/DevicePinPanel";
import AppIdentity from "../components/AppIdentity";

function SettingsPage() {
  return (
    <main className="min-h-dvh bg-[#F6F7FB] pb-28 text-[#242231]">
      <div className="mx-auto max-w-3xl px-4 py-7 sm:px-6 sm:py-10">
        <AppIdentity kind="settings" title="통합 설정" subtitle="Jace AI Hub 공통 보안" />
        <p className="mt-2 text-sm leading-6 text-gray-500">계정 보안과 기기 잠금은 여기에서 한 번만 설정하면 가계부·운동·식단·언어 앱에 함께 적용됩니다.</p>
        <div className="mt-6 grid gap-4">
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
