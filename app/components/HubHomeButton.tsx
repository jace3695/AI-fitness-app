"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";

const hidden = ["/login", "/forgot-password", "/reset-password", "/offline"];

export default function HubHomeButton() {
  const pathname = usePathname();
  if (pathname === "/" || hidden.some((route) => pathname.startsWith(route))) return null;
  return (
    <Link href="/" className="hub-home-button" aria-label="제이스 비서 홈으로 이동">
      <span className="hub-home-button-mark" aria-hidden="true"><Image src="/app-icons/assistant.png" alt="" width={24} height={24} /></span>
      <span>제이스 홈</span>
    </Link>
  );
}