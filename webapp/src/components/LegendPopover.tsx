"use client";

import { useState, useRef, useEffect } from 'react';

// 색상 범례 — 네이티브 title 대신 호버/클릭 모두 동작하는 팝오버.
const ITEMS: Array<{ color: string; label: string; desc: string }> = [
  { color: 'var(--surge)', label: '급증', desc: '평시 대비 크게 늘어남' },
  { color: 'var(--watch)', label: '주의', desc: '평시 대비 다소 늘어남' },
  { color: 'var(--text-mute)', label: '안정', desc: '평시 수준' },
  { color: 'var(--good)', label: '개선', desc: '평시 대비 줄어듦' },
];

export function LegendPopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div
      ref={ref}
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="색상 범례"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 20, height: 20, borderRadius: 10,
          background: 'var(--panel-2)', border: '1px solid var(--border)',
          color: 'var(--text-mute)', fontFamily: 'var(--mono)', fontSize: 11,
          cursor: 'pointer', userSelect: 'none', padding: 0,
        }}
      >
        ?
      </button>

      {open && (
        <div
          role="tooltip"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 30,
            minWidth: 220,
            background: 'var(--panel)',
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
            padding: '10px 12px',
            boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
          }}
        >
          <div style={{
            fontSize: 11, color: 'var(--text-mute)', fontFamily: 'var(--mono)',
            marginBottom: 8,
          }}>
            색상 범례
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {ITEMS.map(it => (
              <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  flexShrink: 0, width: 9, height: 9, borderRadius: 5, background: it.color,
                }} />
                <span style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 500 }}>
                  {it.label}
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
                  {it.desc}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
