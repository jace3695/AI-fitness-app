import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import CatAnimationStage from '../../components/yeoni/CatAnimationStage';
import { updateYeoniPreferences, useYeoniPreferences } from '../../components/useYeoniPreferences';
import './lab.css';

function Lab() {
  const prefs = useYeoniPreferences();
  const [mounted, setMounted] = useState(true);
  const [broken, setBroken] = useState(false);
  const [dark, setDark] = useState(false);
  const [notice, setNotice] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  function save(change: Parameters<typeof updateYeoniPreferences>[0]) {
    try { updateYeoniPreferences(change); setNotice('이 기기에 설정을 저장했어요.'); }
    catch { setNotice('설정을 저장하지 못했지만 지금 화면에는 적용했어요.'); }
  }
  return <main>
    <p className="eyebrow">AI 연이 · 움직임 미리보기</p>
    <h1>조금 더 살아 있는 연이</h1>
    <p className="intro">눈을 깜빡이고, 가볍게 숨을 쉬고, 꼬리를 살짝 움직여요.</p>
    <section className={dark ? 'portrait dark' : 'portrait'} aria-label="고양이 연이">
      {mounted && <CatAnimationStage assetUrl={broken ? '/missing-atlas.png' : undefined} />}
      {!prefs.visible && <p className="empty">연이를 숨겼어요.</p>}
      {!mounted && <p className="empty">다른 화면으로 이동했어요.</p>}
    </section>
    <div className="controls">
      <button onClick={() => save({ motion: prefs.motion === 'home' ? 'off' : 'home' })}>{prefs.motion === 'home' ? '움직임 멈추기' : '움직임 켜기'}</button>
      <button onClick={() => save({ visible: !prefs.visible })}>{prefs.visible ? '연이 숨기기' : '연이 보이기'}</button>
      <button onClick={() => setDark(!dark)}>배경 바꾸기</button>
    </div>
    <p className="notice" role="status">{notice || '처음에는 정지 상태예요. 움직임 켜기를 눌러 보세요.'}</p>
    <p className="caption">이번 단계는 기본 움직임 미리보기예요. 음성과 입모양 연결은 다음 단계에서 진행합니다.</p>
    <details open className="checks"><summary>동작 확인</summary>
      <label>입력 중 잠시 쉬기<input placeholder="여기에 글을 입력해 보세요" /></label>
      <div className="controls">
        <button onClick={() => dialog.current?.showModal()}>안내 창 열기</button>
        <button onClick={() => setMounted(!mounted)}>{mounted ? '다른 화면으로 이동' : '연이 화면 돌아오기'}</button>
        <button onClick={() => setBroken(!broken)}>{broken ? '이미지 복구' : '이미지 오류 확인'}</button>
        <button onClick={() => location.reload()}>새로고침</button>
      </div>
      <p>운영 계정·개인 기록·음성 API에 연결하지 않는 독립 검증 화면입니다.</p>
    </details>
    <dialog ref={dialog}>
      <h2>잠시 쉬고 있어요</h2><p>창을 닫으면 연이가 다시 움직여요.</p>
      <button onClick={() => dialog.current?.close()}>닫기</button>
    </dialog>
    <div className="scroll-check">아래로 내려오면 화면 밖 연이의 움직임이 멈춥니다.</div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Lab /></StrictMode>);
