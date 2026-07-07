"use client";

import { useEffect } from 'react';

export default function ProductError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[product] error:', error);
  }, [error]);

  const msg = error.message || String(error);
  const isQuota = /quota|QueryUsagePerUserPerDay|PERMISSION_DENIED/i.test(msg);
  const isAuth = /reauthentication|invalid_grant|unauthenticated/i.test(msg);

  return (
    <div className="page">
      <p className="eyebrow" style={{ margin: 0 }}>Product Insights</p>
      <div style={{
        marginTop: 24,
        padding: 24,
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--panel)',
        maxWidth: 720,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{
            display: 'inline-block', width: 10, height: 10, borderRadius: 5,
            background: 'var(--surge)',
          }} />
          <h2 style={{ margin: 0, fontSize: 16 }}>
            {isQuota
              ? '데이터 조회 한도를 일시적으로 초과했습니다'
              : isAuth
              ? '데이터베이스 인증이 만료됐습니다'
              : '데이터를 불러오는 중 오류가 발생했습니다'}
          </h2>
        </div>
        <p style={{ fontSize: 13.5, color: 'var(--text-dim)', lineHeight: 1.6, marginTop: 6 }}>
          {isQuota
            ? (<>
                오늘 BigQuery 쿼리 한도(<code style={{ fontFamily: 'var(--mono)' }}>QueryUsagePerUserPerDay</code>)에
                도달했습니다. 필터를 자주 변경하면 각 조합마다 새 쿼리가 실행되어 축적됩니다.<br />
                <b>매일 자정(UTC)에 자동 리셋</b>되며, 그 전에 필요한 경우 관리자에게 한도 상향을 요청해 주세요.
              </>)
            : isAuth
            ? '서버의 서비스 계정 인증이 만료됐습니다. 관리자에게 재발급을 요청해 주세요.'
            : (<>일시적 문제일 수 있어요. 몇 초 뒤 다시 시도해 주세요. 계속되면 관리자에게 알려주세요.</>)}
        </p>
        <details style={{ marginTop: 16, fontSize: 11.5, color: 'var(--text-mute)' }}>
          <summary style={{ cursor: 'pointer' }}>기술 세부 정보</summary>
          <pre style={{
            marginTop: 8,
            padding: 10,
            background: 'var(--panel-2)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            fontFamily: 'var(--mono)',
            fontSize: 11,
            overflow: 'auto',
            maxHeight: 240,
          }}>
            {msg}
            {error.digest && `\n\ndigest: ${error.digest}`}
          </pre>
        </details>
        <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
          <button
            onClick={reset}
            style={{
              padding: '8px 16px', borderRadius: 6,
              background: 'var(--accent)',
              border: 'none',
              color: '#fff',
              fontSize: 13, fontWeight: 500,
              cursor: 'pointer',
            }}
          >다시 시도</button>
          <a
            href="/product"
            style={{
              padding: '8px 16px', borderRadius: 6,
              background: 'var(--panel-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-dim)',
              fontSize: 13,
              textDecoration: 'none',
            }}
          >기본 화면으로</a>
        </div>
      </div>
    </div>
  );
}
