import type { Metadata } from "next";
import AuthGate from "../components/AuthGate";
import TopNav from "@/components/TopNav";
import ScrollTopButton from "@/components/ScrollTopButton";
import LanguageCloudSync from "@/components/LanguageCloudSync";
import AppIdentity from "../components/AppIdentity";
import "./language.css";

export const metadata: Metadata = {
  title: "언어 학습 | AI 연이",
  description: "AI 연이의 일본어 학습 기능",
};

export default function LanguageLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthGate>
      <div className="language-app-shell">
        <header className="app-module-header"><div className="app-module-header-inner"><AppIdentity kind="language" title="일본어 학습" subtitle="매일 이어가는 언어 훈련" /><TopNav /></div></header>
        <main className="app-main">{children}</main>
        <ScrollTopButton />
        <LanguageCloudSync />
      </div>
    </AuthGate>
  );
}
