import type { Metadata, Viewport } from 'next';
import './globals.css';
import PwaManager from './components/PwaManager';

export const metadata: Metadata = {
  title: 'Jace AI Hub | 개인 AI 비서 플랫폼',
  description: 'AI 비서를 중심으로 가계부·운동·언어 학습을 관리하는 Jace님의 개인 플랫폼.',
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Jace AI Hub',
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
