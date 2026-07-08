"use client";

import { useState, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { buildProductHref, type ProductFilters } from '@/lib/product-url';

// + 버튼 → 팝오버 2단계 (필터 종류 → 값 선택). 값 목록은 서버에서 내려준
// allSurges distinct라 BQ 추가 쿼리 없음.

export type FilterOptions = {
  category1: Array<{ value: string; count: number }>;
  category2: Array<{ value: string; count: number }>;
  category3: Array<{ value: string; count: number }>;
};

type Kind = 'category1' | 'category2' | 'category3';

const KIND_META: Array<{ kind: Kind; label: string; hint: string }> = [
  { kind: 'category1', label: '대분류', hint: '유저 / 기업' },
  { kind: 'category2', label: '중분류', hint: '계정, 수수료, 포지션 …' },
  { kind: 'category3', label: '소분류', hint: '비밀번호변경, 환불 …' },
];

export function FilterAdd({
  filters,
  options,
}: {
  filters: ProductFilters;
  options: FilterOptions;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind | null>(null);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  // 바깥 클릭으로 닫기
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setKind(null);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const list = useMemo(() => {
    if (!kind) return [];
    const all = options[kind];
    const q = search.trim().toLowerCase();
    return q ? all.filter(o => o.value.toLowerCase().includes(q)) : all;
  }, [kind, search, options]);

  // 이미 활성화된 필터 종류는 메뉴에서 숨김 (chip × 로 해제 후 다시 추가)
  const availableKinds = KIND_META.filter(m => {
    if (m.kind === 'category1') return filters.seg === 'all';
    if (m.kind === 'category2') return !filters.category2;
    return !filters.category3;
  });

  function pick(value: string) {
    const patch =
      kind === 'category1'
        ? { seg: (value === '유저' ? 'user' : 'company') as 'user' | 'company' }
        : kind === 'category2'
        ? { category2: value }
        : { category3: value };
    setOpen(false);
    setKind(null);
    setSearch('');
    router.push(buildProductHref(patch, filters));
  }

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={() => { setOpen(o => !o); setKind(null); setSearch(''); }}
        title="필터 추가 (대분류 / 중분류 / 소분류)"
        aria-label="필터 추가"
        aria-expanded={open}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28, borderRadius: 8,
          background: open ? 'var(--panel-2)' : 'var(--panel)',
          border: '1px solid var(--border)',
          color: 'var(--text-dim)',
          fontSize: 16, lineHeight: 1,
          cursor: 'pointer',
        }}
      >+</button>

      {open && (
        <div style={{
          position: 'absolute', top: 34, left: 0, zIndex: 20,
          minWidth: 230,
          background: 'var(--panel)',
          border: '1px solid var(--border-strong)',
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          padding: 6,
        }}>
          {!kind ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{
                fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-mute)',
                padding: '4px 8px', letterSpacing: '0.1em', textTransform: 'uppercase',
              }}>필터 종류</div>
              {availableKinds.length === 0 && (
                <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-mute)' }}>
                  모든 분류 필터가 적용 중입니다. chip의 ×로 해제 후 변경하세요.
                </div>
              )}
              {availableKinds.map(m => (
                <button
                  key={m.kind}
                  onClick={() => setKind(m.kind)}
                  style={{
                    textAlign: 'left', padding: '7px 10px', borderRadius: 6,
                    background: 'transparent', border: 'none',
                    color: 'var(--text)', fontSize: 12.5, cursor: 'pointer',
                    display: 'flex', justifyContent: 'space-between', gap: 12,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--panel-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span>{m.label}</span>
                  <span style={{ color: 'var(--text-mute)', fontSize: 11 }}>{m.hint}</span>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px' }}>
                <button
                  onClick={() => { setKind(null); setSearch(''); }}
                  aria-label="뒤로"
                  style={{
                    background: 'transparent', border: 'none',
                    color: 'var(--text-mute)', cursor: 'pointer', fontSize: 14, padding: 2,
                  }}
                >‹</button>
                <input
                  autoFocus
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={`${KIND_META.find(m => m.kind === kind)!.label} 검색`}
                  style={{
                    flex: 1, padding: '5px 8px',
                    background: 'var(--panel-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 5, color: 'var(--text)',
                    fontSize: 12, outline: 'none',
                  }}
                />
              </div>
              <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                {list.length === 0 ? (
                  <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-mute)' }}>
                    일치하는 항목 없음
                  </div>
                ) : (
                  list.map(o => (
                    <button
                      key={o.value}
                      onClick={() => pick(o.value)}
                      style={{
                        width: '100%', textAlign: 'left',
                        padding: '6px 10px', borderRadius: 5,
                        background: 'transparent', border: 'none',
                        color: 'var(--text)', fontSize: 12.5, cursor: 'pointer',
                        display: 'flex', justifyContent: 'space-between', gap: 12,
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--panel-2)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <span>{o.value}</span>
                      <span style={{
                        fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-mute)',
                      }}>{o.count}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
