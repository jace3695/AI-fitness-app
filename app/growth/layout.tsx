import type { Metadata } from "next";
import AuthGate from "../components/AuthGate";

export const metadata: Metadata = {
  title: "자기계발 | AI 연이",
  description: "운동·일본어·개인 연습을 한곳에서 이어가는 오늘의 자기계발",
};

export default function GrowthLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}
