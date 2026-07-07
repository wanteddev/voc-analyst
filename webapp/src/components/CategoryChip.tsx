import Link from 'next/link';
import { buildProductHref, type ProductFilters } from '@/lib/product-url';

// filter-sticky 안에 표시되는 cat2/cat3 chip. × 클릭 시 해당 param만 URL에서 제거.

export function CategoryChip({
  kind,
  value,
  filters,
}: {
  kind: 'category2' | 'category3';
  value: string;
  filters: ProductFilters;
}) {
  const label = kind === 'category2' ? '중분류' : '소분류';
  const patch = kind === 'category2' ? { category2: null } : { category3: null };
  // 소분류(category3)만 해제 시 중분류(category2)는 유지 → chip은 그대로 남음.
  return (
    <span
      title={`${label} 필터: ${value} · × 클릭하여 해제`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '3px 4px 3px 8px',
        borderRadius: 6,
        background: 'var(--panel-2)',
        border: '1px solid var(--border-strong)',
        fontFamily: 'var(--mono)', fontSize: 11,
        color: 'var(--text-dim)',
      }}
    >
      <span style={{ color: 'var(--text-mute)' }}>{label}:</span>
      <span style={{ color: 'var(--text)' }}>{value}</span>
      <Link
        href={buildProductHref(patch, filters)}
        title="이 필터 해제"
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 16, height: 16, borderRadius: 3,
          color: 'var(--text-mute)',
          textDecoration: 'none',
          fontSize: 12,
          lineHeight: 1,
        }}
      >×</Link>
    </span>
  );
}
