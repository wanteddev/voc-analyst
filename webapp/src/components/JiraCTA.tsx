"use client";

import { useState } from 'react';

type SurgeInput = {
  category1: string;
  category2: string;
  category3: string;
  recent_7d: number;
  baseline_daily_avg: number;
  ratio: number;
  recent_negative_ratio: number | null;
  surge_level: 'SURGE' | 'WATCH' | 'IMPROVED';
};

type Status = 'idle' | 'creating' | 'done' | 'error';

export function JiraCTA({ surge }: { surge: SurgeInput }) {
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<{ key: string; url: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setStatus('creating');
    setErr(null);
    try {
      const resp = await fetch('/api/jira/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(surge),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      setResult({ key: data.key, url: data.url });
      setStatus('done');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      setStatus('error');
    }
  }

  if (status === 'done' && result) {
    return (
      <a
        href={result.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontFamily: 'var(--mono)', fontSize: 11,
          padding: '4px 10px', borderRadius: 4,
          background: 'var(--good-tint)',
          border: '1px solid var(--good)',
          color: 'var(--good)',
          textDecoration: 'none',
        }}
      >
        ✓ {result.key} ↗
      </a>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button
        onClick={submit}
        disabled={status === 'creating'}
        style={{
          fontFamily: 'var(--mono)', fontSize: 11,
          padding: '4px 10px', borderRadius: 4,
          background: 'var(--panel-2)',
          border: '1px solid var(--border-strong)',
          color: 'var(--text-dim)',
          cursor: status === 'creating' ? 'wait' : 'pointer',
        }}
      >
        {status === 'creating' ? '생성 중…' : 'Jira 이슈 생성'}
      </button>
      {err && (
        <span style={{ color: 'var(--surge)', fontSize: 11, fontFamily: 'var(--mono)' }}>
          {err.length > 60 ? err.slice(0, 60) + '…' : err}
        </span>
      )}
    </div>
  );
}
