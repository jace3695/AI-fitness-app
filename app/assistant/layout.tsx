import type { ReactNode } from "react";
import AuthGate from "../components/AuthGate";

export const metadata = {
  title: "AI 연이 | 개인 AI 비서",
  description: "Jace님의 일상과 기록을 한결같이 이어주는 AI 비서 연이",
};

export default function AssistantLayout({ children }: { children: ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}
