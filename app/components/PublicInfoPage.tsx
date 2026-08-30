import Link from "next/link";
import { AppIcon } from "./AppIdentity";

type Section = {
  title: string;
  paragraphs?: string[];
  items?: string[];
};

export default function PublicInfoPage({
  eyebrow,
  title,
  description,
  updatedAt,
  sections,
}: {
  eyebrow: string;
  title: string;
  description: string;
  updatedAt?: string;
  sections: Section[];
}) {
  return (
    <main className="min-h-dvh bg-[#F5F4FA] px-4 py-10 text-[#242231] sm:px-6 sm:py-14">
      <div className="mx-auto max-w-3xl overflow-hidden rounded-[30px] border border-white bg-white shadow-[0_22px_55px_rgba(81,70,166,0.12)]">
        <header className="bg-gradient-to-br from-[#5146A6] to-[#766DCE] px-6 py-8 text-white sm:px-10 sm:py-10">
          <div className="flex items-center gap-3">
            <AppIcon kind="assistant" className="h-12 w-12" />
            <div>
              <p className="text-xs font-bold tracking-[0.14em] text-white/70">{eyebrow}</p>
              <p className="mt-1 text-sm font-semibold text-white/90">AI 연이</p>
            </div>
          </div>
          <h1 className="mt-7 text-3xl font-bold leading-tight sm:text-4xl">{title}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-white/80 sm:text-base">{description}</p>
          {updatedAt ? <p className="mt-4 text-xs font-semibold text-white/65">시행일: {updatedAt}</p> : null}
        </header>

        <div className="space-y-8 px-6 py-8 sm:px-10 sm:py-10">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-xl font-bold text-[#312A70]">{section.title}</h2>
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph} className="mt-3 text-sm leading-7 text-[#5C5967] sm:text-[15px]">
                  {paragraph}
                </p>
              ))}
              {section.items ? (
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-7 text-[#5C5967] sm:text-[15px]">
                  {section.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : null}
            </section>
          ))}

          <footer className="flex flex-wrap gap-2 border-t border-gray-100 pt-6 text-sm font-bold text-[#5146A6]">
            <Link href="/about" className="rounded-xl bg-[#F1EFFF] px-3 py-2">앱 소개</Link>
            <Link href="/privacy" className="rounded-xl bg-[#F1EFFF] px-3 py-2">개인정보처리방침</Link>
            <Link href="/terms" className="rounded-xl bg-[#F1EFFF] px-3 py-2">서비스 이용약관</Link>
          </footer>
        </div>
      </div>
    </main>
  );
}
