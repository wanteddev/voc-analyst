import type { Metadata } from 'next';
import { Suspense } from 'react';
import './globals.css';
import { ChatSidebar } from '@/components/ChatSidebar';
import { ThemeToggle } from '@/components/ThemeToggle';
import { TrackView } from '@/components/TrackView';
import { HintLayer } from '@/components/HintLayer';
import { ErrorReporter } from '@/components/ErrorReporter';

export const metadata: Metadata = {
  title: 'VOC Dashboard',
  description: 'Voice of Customer 급증 감지·트렌드·액션 트래킹',
};

// FOUC 방지: React hydration 전에 localStorage 값 읽어 data-theme 세팅.
const THEME_INIT_SCRIPT = `
(function() {
  try {
    var t = localStorage.getItem('theme');
    if (t === 'dark' || t === 'light') {
      document.documentElement.setAttribute('data-theme', t);
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <nav className="topnav">
          <div className="topnav-inner">
            <div className="brand">
              <div className="logo">V</div>
              <span className="name">VOC Dashboard</span>
              <span className="sub">wanted_ml_voc</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ThemeToggle />
              <a
                href="/admin"
                data-hint="관리자 — 사용 현황 (비밀번호 필요)"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  height: 32, boxSizing: 'border-box',
                  padding: '0 12px', borderRadius: 8,
                  border: '1px solid var(--border)', background: 'var(--panel-2)',
                  color: 'var(--text-dim)', fontSize: 12, textDecoration: 'none',
                }}
              >
                <span aria-hidden>🔒</span> 관리자
              </a>
            </div>
          </div>
        </nav>
        <main className="container">{children}</main>
        <ChatSidebar />
        <HintLayer />
        <ErrorReporter />
        <Suspense fallback={null}>
          <TrackView />
        </Suspense>
      </body>
    </html>
  );
}
