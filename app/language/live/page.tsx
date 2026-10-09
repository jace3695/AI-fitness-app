import type { Metadata } from 'next';
import LiveWorkspace from '@/components/language/live/LiveWorkspace';
import './live.css';

export const metadata: Metadata = {
  title: 'AI Live 학습 기록 | AI 연이',
  description: '일본어 수업 보고서를 직접 붙여넣고 확인해 보관합니다.',
};

export default async function LivePage({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const view = (await searchParams).view;
  const initialView = view === 'history' || view === 'learning' || view === 'prepare' ? view : 'import';
  return <LiveWorkspace key={initialView} initialView={initialView} />;
}
