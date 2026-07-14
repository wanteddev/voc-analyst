"use client";

import { useEffect } from 'react';
import { track } from '@/lib/track-client';

// 클라이언트 런타임 에러를 사용 트래킹 스트림에 client_error로 기록 → 관리자 '최근 에러' 패널에 노출.
// (조용히 묻히던 에러 가시화. 실패해도 사용자 영향 없음.)
export function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      track('client_error', {
        detail: `${e.message} @ ${e.filename || ''}:${e.lineno || 0}`.slice(0, 280),
        path: location.pathname,
      });
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      track('client_error', {
        detail: `unhandledrejection: ${String(e.reason)}`.slice(0, 280),
        path: location.pathname,
      });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
