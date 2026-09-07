"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import styles from "./yeoni-mascot.module.css";

export type YeoniAction = "idle" | "explain" | "celebrate" | "encourage";
export type YeoniMotion = "once" | "ambient" | "off";

function AnimationStrip({ action, motion, canPlay }: { action: YeoniAction; motion: YeoniMotion; canPlay: boolean }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  if (failed) return <span className={styles.fallback}>✦</span>;

  return <span className={styles.pose} data-motion={motion} data-playing={ready && canPlay}>
    <Image
      src="/yeoni-cat-sprite-v1.webp"
      alt=""
      width={1254}
      height={1254}
      sizes="(max-width: 420px) 288px, 384px"
      className={`${styles.sheet} ${styles[action]}`}
      data-ready={ready}
      draggable={false}
      onLoad={() => setReady(true)}
      onError={() => setFailed(true)}
    />
  </span>;
}

/** Decorative motion only; the learning feedback always remains available as text. */
export default function YeoniMascot({ action = "idle", motionKey = "", motion = "once" }: {
  action?: YeoniAction;
  motionKey?: string | number;
  motion?: YeoniMotion;
}) {
  const frameRef = useRef<HTMLSpanElement>(null);
  const [pageVisible, setPageVisible] = useState(false);
  const [inView, setInView] = useState(false);
  // Only a resting pose may repeat; lesson reactions remain finite.
  const effectiveMotion = motion === "ambient" && action !== "idle" ? "once" : motion;

  useEffect(() => {
    const updateVisibility = () => setPageVisible(!document.hidden);
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.05 },
    );
    if (observer && frameRef.current) observer.observe(frameRef.current);
    else setInView(true);
    return () => {
      document.removeEventListener("visibilitychange", updateVisibility);
      observer?.disconnect();
    };
  }, []);

  return <span ref={frameRef} className={styles.frame} data-yeoni-action={action} data-yeoni-motion={effectiveMotion} aria-hidden="true">
    <AnimationStrip key={`${action}:${motionKey}`} action={action} motion={effectiveMotion} canPlay={pageVisible && inView} />
  </span>;
}
