"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function AdminLogin({ configured }: { configured: boolean }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pw || loading) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (r.ok) {
        router.refresh();
        return;
      }
      const j = await r.json().catch(() => ({}));
      setErr(j.error || `로그인 실패 (HTTP ${r.status})`);
    } catch {
      setErr('네트워크 오류입니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: '80px auto', textAlign: 'center' }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>🔒</div>
      <h1 style={{ fontSize: 18, marginBottom: 6 }}>관리자 인증</h1>
      <p style={{ color: 'var(--text-mute)', fontSize: 12.5, marginBottom: 18 }}>
        사용 현황(방문·필터·에이전트 질의)을 보려면 비밀번호를 입력하세요.
      </p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input
          type="password"
          value={pw}
          autoFocus
          onChange={e => setPw(e.target.value)}
          placeholder="비밀번호"
          disabled={!configured || loading}
          style={{
            padding: '10px 12px',
            background: 'var(--panel-2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text)',
            fontSize: 14,
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={!configured || loading || !pw}
          style={{
            padding: '10px 12px',
            borderRadius: 6,
            background: pw && configured ? 'var(--accent)' : 'var(--panel-2)',
            border: 'none',
            color: pw && configured ? '#fff' : 'var(--text-mute)',
            fontSize: 14,
            fontWeight: 500,
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? '확인 중…' : '입장'}
        </button>
      </form>
      {!configured && (
        <p style={{ color: 'var(--surge)', fontSize: 12, marginTop: 12 }}>
          서버에 ADMIN_PASSWORD가 아직 설정되지 않았습니다.
        </p>
      )}
      {err && <p style={{ color: 'var(--surge)', fontSize: 12.5, marginTop: 12 }}>{err}</p>}
    </div>
  );
}
