"use client";

import { memo, useEffect, useState } from "react";

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours ? `${hours}:` : ""}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Refresh only the clock, not the routine list and all growth statistics. */
function RoutineElapsedTime({ startedAt }: { startedAt: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.parse(startedAt);
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => setSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    const onVisibility = () => {
      clearInterval(timer);
      if (!document.hidden) {
        update();
        timer = setInterval(update, 1000);
      }
    };
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [startedAt]);
  return <span role="timer" aria-live="off" aria-label="루틴 경과 시간">{formatDuration(seconds)}</span>;
}

export default memo(RoutineElapsedTime);
