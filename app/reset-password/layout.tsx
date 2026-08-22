import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Jace AI Hub | 공통 계정",
  description: "Jace AI Hub 개인 앱 공통 계정 인증",
};

export default function SharedAuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
