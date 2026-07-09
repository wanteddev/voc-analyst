"use client";

import { useEffect, useState } from 'react';

// 앱 전역 커스텀 툴팁 — 네이티브 title이 브라우저/OS에 따라 안 뜨는 문제 대체.
// [data-hint] 속성을 가진 요소에 호버하면 position:fixed 툴팁을 띄움(overflow에
// 잘리지 않음). 이벤트 위임 1개 + 공용 툴팁 1개라 마크업 구조 변경 없음.
type Hint = { text: string; x: number; y: number };

export function HintLayer() {
  const [hint, setHint] = useState<Hint | null>(null);

  useEffect(() => {
    let current: Element | null = null;

    function show(el: Element) {
      const text = el.getAttribute('data-hint');
      if (!text) return;
      current = el;
      const r = el.getBoundingClientRect();
      setHint({ text, x: r.left + r.width / 2, y: r.bottom });
    }
    function onOver(e: Event) {
      const el = (e.target as Element)?.closest?.('[data-hint]');
      if (el) show(el);
    }
    function onOut(e: Event) {
      const el = (e.target as Element)?.closest?.('[data-hint]');
      if (el && el === current) {
        current = null;
        setHint(null);
      }
    }
    function hide() {
      current = null;
      setHint(null);
    }

    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('focusin', onOver);
    document.addEventListener('focusout', onOut);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);

    return () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
      document.removeEventListener('focusin', onOver);
      document.removeEventListener('focusout', onOut);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  if (!hint) return null;

  const half = 150;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const x = Math.min(Math.max(hint.x, half + 8), vw - half - 8);

  return (
    <div
      role="tooltip"
      style={{
        position: 'fixed',
        left: x,
        top: hint.y + 8,
        transform: 'translateX(-50%)',
        maxWidth: 2 * half,
        zIndex: 1000,
        pointerEvents: 'none',
        background: 'var(--panel)',
        border: '1px solid var(--border-strong)',
        borderRadius: 6,
        padding: '7px 10px',
        fontSize: 12,
        lineHeight: 1.45,
        color: 'var(--text)',
        boxShadow: '0 6px 20px rgba(0,0,0,0.28)',
        whiteSpace: 'pre-line',
      }}
    >
      {hint.text}
    </div>
  );
}
