import Link from 'next/link';
import type { SegSummary } from '@/lib/queries';
import { buildProductHref, type ProductFilters } from '@/lib/product-url';

type Seg = 'all' | 'user' | 'company';

export function SegFilter({
  filters,
  summary,
}: {
  filters: ProductFilters;
  summary: SegSummary;
}) {
  const items: Array<{ key: Seg; label: string; count: number }> = [
    { key: 'all',     label: '전체', count: summary.all },
    { key: 'user',    label: '유저', count: summary.user },
    { key: 'company', label: '기업', count: summary.company },
  ];

  return (
    <div style={{
      display: 'inline-flex', gap: 2,
      padding: 3,
      background: 'var(--panel)',
      border: '1px solid var(--border)',
      borderRadius: 8,
    }}>
      {items.map(({ key, label, count }) => {
        const active = filters.seg === key;
        const zero = count === 0;
        return (
          <Link
            key={key}
            href={buildProductHref({ seg: key }, filters)}
            title={`${label} · 최근 7일 ${count}건`}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 500,
              color: zero ? 'var(--text-mute)' : active ? 'var(--text)' : 'var(--text-dim)',
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
              {count.toLocaleString()}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
