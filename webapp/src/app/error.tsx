"use client";

import { useEffect } from 'react';
import { track } from '@/lib/track-client';

// 앱 세그먼트 전역 에러 바운더리 — 서버 컴포넌트 렌더 에러(예: 관리자 페이지)까지 포착해
// client_error로 기록하고 사용자에겐 친절한 폴백을 보여줌.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    track('client_error', {
      detail: `RSC: ${error.message} [${error.digest ?? ''}]`.slice(0, 280),
      path: typeof location !== 'undefined' ? location.pathname : '',
    });
  }, [error]);

  return (
    <div style={{ maxWidth: 420, margin: '80px auto', textAlign: 'center' }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
      <h1 style={{ fontSize: 18, marginBottom: 6 }}>일시적인 오류가 발생했어요</h1>
      <p style={{ color: 'var(--text-mute)', fontSize: 12.5, marginBottom: 18 }}>
        잠시 후 다시 시도해주세요. 문제가 계속되면 관리자에게 문의해주세요.
      </p>
      <button
        onClick={reset}
        style={{
          padding: '9px 16px', borderRadius: 8,
          background: 'var(--accent)', border: 'none', color: '#fff',
          fontSize: 13, fontWeight: 500, cursor: 'pointer',
        }}
      >
        다시 시도
      </button>
    </div>
  );
}
