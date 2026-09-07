import AppCompanion from "@/components/AppCompanion";
import Link from "next/link";
import AuthGate from "./AuthGate";
import RecordResetPanel from "./RecordResetPanel";
import { APP_RESET_INFO, type RecordResetApp } from "../data/appRecordReset";

export default function AppRecordSettings({ app }: { app: RecordResetApp }) {
  const info = APP_RESET_INFO[app];
  return <AuthGate><main className="min-h-dvh bg-[#F6F7FB] px-4 py-8 text-gray-900"><div className="mx-auto max-w-3xl space-y-5">
    <Link href={app === "assistant" ? "/assistant" : `/${app}`} className="inline-flex min-h-11 items-center font-bold text-violet-700">← {info.label} 앱으로 돌아가기</Link>
    <h1 className="text-2xl font-bold">{info.label} 설정</h1>
    <AppCompanion compact quiet>지워지는 기록을 먼저 확인해 주세요. 마음이 바뀌면 확인 창에서 취소할 수 있어요.</AppCompanion>
    <RecordResetPanel app={app} />
    <Link href="/settings" className="inline-flex min-h-11 items-center font-bold text-gray-600">연이 캐릭터·계정·보안 설정 →</Link>
  </div></main></AuthGate>;
}
