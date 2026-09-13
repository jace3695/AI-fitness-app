import AppCompanion from "@/components/AppCompanion";
import Link from "next/link";
import AuthGate from "./AuthGate";
import RecordResetPanel from "./RecordResetPanel";
import { APP_RESET_INFO, type RecordResetApp } from "../data/appRecordReset";

export default function AppRecordSettings({ app }: { app: RecordResetApp }) {
  const info = APP_RESET_INFO[app];
  return <AuthGate><main className="min-h-dvh bg-yeoni-bg px-4 py-8 text-gray-900"><div className="mx-auto max-w-3xl space-y-5">
    <Link href={app === "assistant" ? "/assistant" : `/${app}`} className="inline-flex min-h-11 items-center font-bold text-violet-700">← {info.label} 앱으로 돌아가기</Link>
    <h1 className="text-2xl font-bold">{info.label} 설정</h1>
    <AppCompanion compact quiet>자주 쓰는 설정을 먼저 살펴봐요. 기록 정리는 아래에서 따로 할 수 있어요.</AppCompanion>
    <Link href="/settings" className="inline-flex min-h-11 items-center font-bold text-gray-600">연이 캐릭터·계정·보안 설정 →</Link>
    <section className="rounded-2xl border border-gray-200 bg-white p-4"><h2 className="text-lg font-bold">기록 관리</h2><p className="mt-1 text-sm text-gray-500">삭제 범위를 확인한 뒤 필요한 기록만 정리하세요.</p><RecordResetPanel app={app} /></section>
  </div></main></AuthGate>;
}
