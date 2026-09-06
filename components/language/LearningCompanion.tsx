import Image from "next/image";
import type { ReactNode } from "react";
import styles from "./learning-focus.module.css";

export default function LearningCompanion({ children, hidden = false }: { children: ReactNode; hidden?: boolean }) {
  return <aside className={hidden ? styles.quietGuide : styles.companion} aria-label="연이의 학습 안내">
    {!hidden && <Image src="/japanese-learning-companion.png" width={96} height={96} alt="" className={styles.mascot} sizes="96px" />}
    <div className={styles.bubble}>{!hidden && <span className={styles.guideName}>연이와 함께</span>}<p>{children}</p></div>
  </aside>;
}
