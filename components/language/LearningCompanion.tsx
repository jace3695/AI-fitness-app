import type { ReactNode, Ref } from "react";
import YeoniMascot, { type YeoniAction, type YeoniMotion } from "@/components/YeoniMascot";
import styles from "./learning-focus.module.css";

export default function LearningCompanion({ children, hidden = false, action = "idle", motionKey, motion = "once", onMotionToggle, anchorRef }: {
  children: ReactNode; hidden?: boolean; action?: YeoniAction; motionKey?: string | number;
  motion?: YeoniMotion; onMotionToggle?: () => void;
  anchorRef?: Ref<HTMLElement>;
}) {
  return <aside ref={anchorRef} className={hidden ? styles.quietGuide : styles.companion} aria-label="연이의 학습 안내">
    {!hidden && <YeoniMascot action={action} motionKey={motionKey} motion={motion} />}
    <div className={styles.bubble}>
      {!hidden && <span className={styles.guideName}>연이와 함께</span>}<p>{children}</p>
      {!hidden && onMotionToggle && <button type="button" className={styles.motionToggle} onClick={onMotionToggle}>{motion === "off" ? "움직임 켜기" : "움직임 멈추기"}</button>}
    </div>
  </aside>;
}
