export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#F6F7FB] p-6 text-center">
      <section className="w-full max-w-md rounded-[28px] bg-white p-7 shadow-sm">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-100 text-2xl" aria-hidden="true">↻</div>
        <h1 className="mt-5 text-xl font-bold text-gray-900">인터넷 연결을 확인해 주세요</h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          아직 저장되지 않은 화면입니다. 인터넷에 다시 연결한 뒤 AI 연이를 열면 기록 동기화를 자동으로 다시 시도합니다.
        </p>
        <a href="/" className="mt-6 inline-block rounded-xl bg-[#534AB7] px-5 py-3 text-sm font-bold text-white">다시 시도</a>
      </section>
    </main>
  );
}
