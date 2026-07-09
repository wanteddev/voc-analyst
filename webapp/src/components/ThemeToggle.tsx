"use client";

import { useEffect, useState } from 'react';

type ThemeChoice = 'light' | 'dark' | 'system';

function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'system') {
    root.removeAttribute('data-theme');
    try { localStorage.removeItem('theme'); } catch { /* ignore */ }
  } else {
    root.setAttribute('data-theme', choice);
    try { localStorage.setItem('theme', choice); } catch { /* ignore */ }
  }
}

function readStored(): ThemeChoice {
  try {
    const v = localStorage.getItem('theme');
    if (v === 'light' || v === 'dark') return v;
  } catch { /* ignore */ }
  return 'system';
}

const ITEMS: Array<{ key: ThemeChoice; label: string; icon: string; title: string }> = [
  { key: 'light',  label: '라이트', icon: '☀', title: '라이트 테마' },
  { key: 'dark',   label: '다크',   icon: '☾', title: '다크 테마' },
  { key: 'system', label: '자동',   icon: '⎈', title: '시스템 설정 따르기' },
];

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>('system');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setChoice(readStored());
    setMounted(true);
  }, []);

  function pick(next: ThemeChoice) {
    setChoice(next);
    applyTheme(next);
  }

  // Hydration-safe: nav 자리 유지 위해 mount 전에도 렌더하되, active 강조는 마운트 후.
  return (
    <div
      role="radiogroup"
      aria-label="테마 선택"
      style={{
        display: 'inline-flex', gap: 2, alignItems: 'center',
        height: 32, boxSizing: 'border-box',
        padding: '0 3px',
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 8,
      }}
    >
      {ITEMS.map(it => {
        const active = mounted && choice === it.key;
        return (
          <button
            key={it.key}
            type="button"
            role="radio"
            aria-checked={active}
            data-hint={it.title}
            onClick={() => pick(it.key)}
            style={{
              padding: '4px 8px',
              borderRadius: 6,
              background: active ? 'var(--panel-2)' : 'transparent',
              border: 'none',
              color: active ? 'var(--text)' : 'var(--text-mute)',
              fontSize: 12,
              fontFamily: 'var(--sans)',
              cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 4,
              transition: 'color .12s, background .12s',
            }}
          >
            <span aria-hidden style={{ fontSize: 13 }}>{it.icon}</span>
            <span style={{ fontSize: 11 }}>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}
