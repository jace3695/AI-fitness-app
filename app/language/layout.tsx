import type { Metadata } from "next";
import AuthGate from "../components/AuthGate";
import TopNav from "@/components/TopNav";
import ScrollTopButton from "@/components/ScrollTopButton";
import LanguageCloudSync from "@/components/LanguageCloudSync";
import AppIdentity from "../components/AppIdentity";
import "./language.css";

export const metadata: Metadata = {
  title: "언어 학습 | Jace AI Hub",
  description: "Jace AI Hub 일본어 학습 모듈",
};

export default function LanguageLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthGate>
      <div className="language-app-shell">
        <header className="app-shell"><div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-2"><AppIdentity kind="language" title="일본어 학습" /><div className="min-w-0 flex-1"><TopNav /></div></div></header>
        <main className="app-main">{children}</main>
        <ScrollTopButton />
        <LanguageCloudSync />
      </div>
    </AuthGate>
  );
}
