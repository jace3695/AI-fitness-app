import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import RecordCalendarView from '../../app/components/RecordCalendarView';
import CloudSyncPanel from '../../app/components/CloudSyncPanel';
import PwaManager from '../../app/components/PwaManager';

function Lab() {
  const [page, setPage] = useState('calendar');
  const [metrics, setMetrics] = useState('');
  const [cleaned, setCleaned] = useState(false);
  const [cleanupStatus, setCleanupStatus] = useState('합성 세션 정리 중');
  useEffect(() => {
    const update = () => setMetrics(`${innerWidth}px / ${document.documentElement.scrollWidth}px / ${document.visibilityState}`);
    const timer = setInterval(update, 1000); update();
    return () => clearInterval(timer);
  }, []);
  const clean = async () => {
    setCleaned(true);
    // Teardown React's sync effect before clearing this disposable origin.
    await new Promise(resolve => setTimeout(resolve, 100));
    localStorage.clear();
    for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
    for (const key of await caches.keys()) await caches.delete(key);
    setCleanupStatus('이 합성 세션의 저장소·서비스워커 정리 완료');
  };
  if (cleaned) return <p role="status">{cleanupStatus}</p>;
  return <>
    <header style={{ padding: 8, background: '#fff', position: 'sticky', top: 0, zIndex: 120 }}>
      <strong>합성 전용 세션 {location.port}</strong>
      <p aria-label="실제 문서 크기">{metrics}</p>
      <button onClick={() => setPage('calendar')}>달력 화면</button>{' '}
      <button onClick={() => setPage('away')}>다른 화면으로 이동</button>{' '}
      <button onClick={() => location.reload()}>세션 새로고침</button>{' '}
      <button onClick={() => void navigator.serviceWorker.getRegistration().then(r => r?.update())}>서비스워커 업데이트 확인</button>{' '}
      <button onClick={() => void clean()}>합성 세션 정리</button>
    </header>
    <PwaManager />
    <main style={{ padding: 8 }}>{page === 'calendar' ? <RecordCalendarView /> : <p>다른 화면: 달력은 해제되고 공통 동기화는 유지됩니다.</p>}</main>
    <div style={{ padding: 8, paddingBottom: 120 }}><CloudSyncPanel hideSignedOut /></div>
  </>;
}
createRoot(document.getElementById('root')!).render(<Lab />);
