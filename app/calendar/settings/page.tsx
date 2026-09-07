import Link from "next/link";
import AuthGate from "@/app/components/AuthGate";
import { APP_RESET_INFO, RECORD_RESET_APPS } from "@/app/data/appRecordReset";
export default function Page() {
  return <AuthGate><main className="min-h-dvh bg-[#F6F7FB] px-4 py-8 text-gray-900"><div className="mx-auto max-w-3xl space-y-5"><Link href="/calendar" className="inline-flex min-h-11 items-center font-bold">← 통합 달력</Link><h1 className="text-2xl font-bold">달력 기록 관리</h1><p className="leading-7">달력에는 각 앱의 기록이 함께 표시됩니다. 지우려는 기록의 앱을 선택해 초기화하세요. Google 캘린더 원본 일정은 해당 캘린더에서 관리할 수 있어요.</p><div className="grid gap-3 sm:grid-cols-2">{RECORD_RESET_APPS.map(app => <Link key={app} href={APP_RESET_INFO[app].href} className="min-h-12 rounded-xl bg-white p-4 font-bold shadow-sm">{APP_RESET_INFO[app].label} 기록 관리 →</Link>)}</div></div></main></AuthGate>;
}
