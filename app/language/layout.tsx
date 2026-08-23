import type { Metadata } from "next";
import AuthGate from "../components/AuthGate";
import TopNav from "@/components/TopNav";
import ScrollTopButton from "@/components/ScrollTopButton";
import "./language.css";

export const metadata: Metadata = {
  title: "언어 학습 | Jace AI Hub",
  description: "Jace AI Hub 일본어 학습 모듈",
};

export default function LanguageLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthGate>
      <div className="language-app-shell">
        <header className="app-shell"><TopNav /></header>
        <main className="app-main">{children}</main>
        <ScrollTopButton />
      </div>
    </AuthGate>
  );
}
