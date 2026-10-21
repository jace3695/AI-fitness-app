// @ts-nocheck -- isolated browser harness globals are defined by check.mjs.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import CommonCharacterShell from '../../components/yeoni/CommonCharacterShell';
import AppCompanion from '../../components/AppCompanion';
import ReplyCharacterPanel from '../../components/yeoni/ReplyCharacterPanel';
import { buildReplyPlan } from '../../lib/yeoni/reply-plan';
import { savedReplyClips, REPLY_SAMPLES } from '../../lib/yeoni/reply-samples';
import { claimSpeechFocus } from '../../lib/yeoni/speech-focus';
const clips = savedReplyClips({ko: QA_SAVED_AUDIO, ja:''}).slice(0,1);
function App() {
  const [path, setPath] = useState('/');
  const [incoming, setIncoming] = useState(null);
  const [quiet, setQuiet] = useState(false);
  window.qa.setQuiet = setQuiet;
  window.qa.path = path;
  window.qa.navigate = setPath;
  return <CommonCharacterShell enabled>
    <main>
      <h1>{path}</h1>
      <AppCompanion quiet={quiet}>기존 안내문을 그대로 보존합니다.</AppCompanion>
      <label>합성 입력<input aria-label="합성 입력" /></label>
      <button onClick={() => { const reply = '안녕하세요. 합성 응답입니다.'; setIncoming({ value: { reply, performance: buildReplyPlan(reply, 'synthetic') } }); }}>합성 응답</button>
      <button onClick={() => { const reply = REPLY_SAMPLES.ko.spokenText; setIncoming({ value: { reply, performance: buildReplyPlan(reply, 'saved') } }); }}>기존 저장 음성 표본</button>
      <button onClick={() => claimSpeechFocus('synthetic-other')}>다른 음성 포커스</button>
      <ReplyCharacterPanel clips={clips} incoming={incoming} />
      <div style={{height:800}}>합성 콘텐츠</div>
    </main>
  </CommonCharacterShell>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
