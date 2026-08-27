import type { ReactNode } from "react";
import AuthGate from "../components/AuthGate";

export const metadata = {
  title: "제이스비서 | Jace AI Hub",
  description: "할 일·프로젝트·회신 대기를 관리하는 Jace AI 비서",
};

export default function AssistantLayout({ children }: { children: ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}
