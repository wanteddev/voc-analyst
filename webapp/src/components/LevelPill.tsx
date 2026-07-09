import Link from 'next/link';
import { type SurgeLevel } from '@/lib/level';
import { buildProductHref, type ProductFilters } from '@/lib/product-url';
import type { StatusSummaryRow } from '@/lib/queries';

// 상단 filter-sticky용 level pill. 5-way (전체/급증/주의/안정/개선).
// 다중 선택: 이미 선택된 걸 클릭하면 해제, 안 된 걸 클릭하면 추가.
// "전체" 클릭 = 모든 level 해제.

const ITEMS: Array<{ key: SurgeLevel | 'ALL'; label: string; klass: string }> = [
  { key: 'ALL',      label: '전체', klass: '' },
  { key: 'SURGE',    label: '급증', klass: '--surge' },
  { key: 'WATCH',    label: '주의', klass: '--watch' },
  { key: 'STABLE',   label: '안정', klass: '' },
  { key: 'IMPROVED', label: '개선', klass: '--good' },
];

const COLORS: Record<string, { active: string; hover: string }> = {
  '--surge': { active: 'var(--surge)', hover: 'var(--surge)' },
  '--watch': { active: 'var(--watch)', hover: 'var(--watch)' },
  '--good':  { active: 'var(--good)',  hover: 'var(--good)'  },
  '':        { active: 'var(--text)',  hover: 'var(--text)'  },
};

export function LevelPill({
  filters,
  summary,
}: {
  filters: ProductFilters;
  summary: StatusSummaryRow[];
}) {
  const map = new Map(summary.map(r => [r.surge_level, Number(r.categories) || 0]));
  const totalCats = Array.from(map.values()).reduce((s, n) => s + n, 0);
  const currentSet = new Set(filters.levels);

  function hrefFor(key: SurgeLevel | 'ALL'): string {
    if (key === 'ALL') return buildProductHref({ levels: [] }, filters);
    const next = new Set(currentSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return buildProductHref({ levels: Array.from(next) as SurgeLevel[] }, filters);
  }

  return (
    <div style={{
      display: 'inline-flex', gap: 2, alignItems: 'center',
      height: 30, boxSizing: 'border-box',
      padding: '0 3px',
      background: 'var(--panel)',
      border: '1px solid var(--border)',
      borderRadius: 8,
    }}>
      {ITEMS.map(({ key, label, klass }) => {
        const active = key === 'ALL' ? currentSet.size === 0 : currentSet.has(key as SurgeLevel);
        const count = key === 'ALL' ? totalCats : (map.get(key as SurgeLevel) ?? 0);
        const zero = count === 0;
        const col = COLORS[klass];
        return (
          <Link
            key={key}
            href={hrefFor(key)}
            data-hint={`${label} · ${count}개 카테고리${key !== 'ALL' && !active ? ' (클릭하여 필터 추가)' : ''}`}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 500,
              color: zero ? 'var(--text-mute)'
                   : active ? col.active
                   : 'var(--text-dim)',
              background: active ? 'var(--panel-2)' : 'transparent',
              opacity: zero ? 0.55 : 1,
              display: 'inline-flex', alignItems: 'baseline', gap: 6,
              transition: 'color .12s, background .12s',
              textDecoration: 'none',
            }}
          >
            <span>{label}</span>
            <span style={{
              fontFamily: 'var(--mono)',
              fontSize: 11,
              color: zero ? 'var(--text-mute)' : active ? 'var(--text-dim)' : 'var(--text-mute)',
            }}>
              {count}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
