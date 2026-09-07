"use client";

import { useEffect, useState } from "react";
import styles from "./scroll-top-button.module.css";

const SHOW_AFTER_SCROLL_Y = 300;

export default function ScrollTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let frame: number | null = null;
    const updateVisibility = () => {
      frame = null;
      setVisible(window.scrollY > SHOW_AFTER_SCROLL_Y);
    };
    const onScroll = () => {
      if (frame === null) frame = window.requestAnimationFrame(updateVisibility);
    };

    updateVisibility();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  const handleClick = () => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "instant" : "smooth" });
  };

  if (!visible) return null;

  return (
    <button
      type="button"
      className={styles.button}
      onClick={handleClick}
      aria-label="맨 위로 이동"
      title="맨 위로 이동"
    >
      <span aria-hidden="true">↑</span> TOP
    </button>
  );
}
