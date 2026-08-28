import type { Metadata } from "next";
import "./budget.css";

export const metadata: Metadata = {
  title: "가계 | AI 연이",
  description: "AI 연이의 가계 기록과 소비 분석",
};

export default function BudgetLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
