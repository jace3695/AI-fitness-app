import type { Metadata } from "next";
import "./budget.css";

export const metadata: Metadata = {
  title: "가계부 | Jace AI Hub",
  description: "Jace AI Hub 통합 가계부",
};

export default function BudgetLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
