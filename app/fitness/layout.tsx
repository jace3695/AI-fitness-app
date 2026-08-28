import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "운동 | AI 연이",
  description: "AI 연이의 운동 계획과 수행 기록",
};

export default function FitnessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
