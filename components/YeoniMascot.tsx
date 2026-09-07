"use client";

import Image from "next/image";
import { useState } from "react";
import styles from "./yeoni-mascot.module.css";

export type YeoniAction = "idle" | "explain" | "celebrate" | "encourage";

function AnimationStrip({ action }: { action: YeoniAction }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  if (failed) return <span className={styles.fallback}>✦</span>;

  return <Image
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
  />;
}

/** Short, decorative reactions. Learning feedback always remains available as text. */
export default function YeoniMascot({ action = "idle", motionKey = "" }: {
  action?: YeoniAction;
  motionKey?: string | number;
}) {
  return <span className={styles.frame} data-yeoni-action={action} aria-hidden="true">
    <AnimationStrip key={`${action}:${motionKey}`} action={action} />
  </span>;
}
