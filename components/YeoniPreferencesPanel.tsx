"use client";

import { useState } from "react";
import AppCompanion from "./AppCompanion";
import { updateYeoniPreferences, useYeoniPreferences } from "./useYeoniPreferences";
import type { YeoniPreferences } from "@/utils/yeoniPreferences";
import styles from "./app-companion.module.css";

export default function YeoniPreferencesPanel() {
  const preferences = useYeoniPreferences();
  const [message, setMessage] = useState("");
  const change = (value: Partial<YeoniPreferences>) => {
    try { updateYeoniPreferences(value); setMessage("이 기기의 모든 앱에 적용하고 저장했어요."); }
    catch { setMessage("지금 화면에는 적용했지만 저장하지 못했어요. 기기의 저장 공간을 확인해 주세요."); }
  };
  return <section className={styles.preferences} aria-label="연이 캐릭터 설정">
    <h2>연이 캐릭터</h2>
    <AppCompanion compact quiet>필요한 순간에 함께할게요. 편한 방식으로 골라 주세요.</AppCompanion>
    <label><input type="checkbox" checked={preferences.visible} onChange={event => change({ visible: event.target.checked })} />모든 앱에서 연이 표시</label>
    <label className={styles.motion}>연이 움직임<select value={preferences.motion} disabled={!preferences.visible} onChange={event => change({ motion: event.target.value as YeoniPreferences["motion"] })}>
      <option value="reactions">절약 · 필요할 때만</option><option value="home">홈에서 가끔 반복</option><option value="off">모든 움직임 끄기</option>
    </select></label>
    <p className={styles.hint}>홈·운동·식단·가계부·일본어·자기계발·달력에 즉시 적용돼요. 이 기기에 저장되며 앱 기록을 초기화해도 유지돼요.</p>
    <p className={styles.hint}>기본은 짧게 한 번 반응해요. 화면 밖·다른 탭·입력 중에는 멈추고, 운동·연습 화면에서는 조용히 기다려요. 기기의 ‘동작 줄이기’도 따라요.</p>
    {message && <p className={styles.hint} role="status">{message}</p>}
  </section>;
}
