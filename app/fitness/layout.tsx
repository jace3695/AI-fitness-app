import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "운동 관리 | Jace AI Hub",
  description: "Jace AI Hub 운동 계획과 기록",
};

export default function FitnessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
