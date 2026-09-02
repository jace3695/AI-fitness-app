import type { Metadata, Viewport } from 'next';
import './globals.css';
import PwaManager from './components/PwaManager';
import AiBudgetNotifier from './components/AiBudgetNotifier';

export const metadata: Metadata = {
  title: 'AI 연이 | 개인 AI 비서',
  description: '운동·식단·가계·언어 학습·일정을 하나의 흐름으로 이어주는 Jace님의 개인 AI 비서.',
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.png',
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'AI 연이',
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: '#0B5D4C',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body>
        <PwaManager />
        <AiBudgetNotifier />
        {children}
      </body>
    </html>
  );
}
