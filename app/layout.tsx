import type { Metadata, Viewport } from 'next';
import './globals.css';
import PwaManager from './components/PwaManager';

export const metadata: Metadata = {
  title: 'AI 운동 — 재민님 맞춤 홈트 플랜',
  description: '재민님을 위한 AI 맞춤 홈 트레이닝 플랜. 준비운동부터 슬라이딩보드, 마무리 스트레칭까지.',
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'AI 운동',
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
        {children}
      </body>
    </html>
  );
}
