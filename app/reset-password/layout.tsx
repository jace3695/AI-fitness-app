import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "비밀번호 재설정 | AI 연이",
  description: "AI 연이 공통 계정의 새 비밀번호 설정",
};

export default function SharedAuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
