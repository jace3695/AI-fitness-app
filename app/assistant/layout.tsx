import type { ReactNode } from "react";
import AuthGate from "../components/AuthGate";

export const metadata = {
  title: "연이 AI 비서 | Jace AI Hub",
  description: "Jace님의 일상과 기록을 한결같이 이어주는 AI 비서 연이",
};

export default function AssistantLayout({ children }: { children: ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}
