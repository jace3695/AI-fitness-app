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
          <section className="rounded-3xl border border-violet-100 bg-gradient-to-br from-white to-[#F1EFFF] p-5 shadow-sm sm:p-6">
            <div className="flex items-start gap-4">
              <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#5146A6] text-xl font-black text-white">연</span>
              <div>
                <p className="text-xs font-bold tracking-[0.16em] text-[#766DB8]">AI ASSISTANT</p>
                <h2 className="mt-1 text-xl font-bold text-[#242231]">연이</h2>
                <p className="mt-2 text-sm leading-6 text-gray-600">‘연이’는 <b className="text-[#3C3489]">한결같이 Jace님의 일상과 기록을 이어주는 존재</b>라는 의미를 담고 있습니다.</p>
                <p className="mt-3 rounded-2xl bg-white/80 px-4 py-3 text-sm font-semibold leading-6 text-[#5146A6]">일정·할 일·가계부·운동·식단·언어 학습을 하나의 흐름으로 이어드릴게요.</p>
              </div>
            </div>
          </section>
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
