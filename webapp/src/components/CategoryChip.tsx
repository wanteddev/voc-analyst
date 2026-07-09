import Link from 'next/link';
import { buildProductHref, type ProductFilters } from '@/lib/product-url';

// filter-sticky 안에 표시되는 대/중/소분류 chip. × 클릭 시 해당 필터만 해제.

const META = {
  category1: { label: '대분류' },
  category2: { label: '중분류' },
  category3: { label: '소분류' },
  emotion: { label: '감정' },
} as const;

export function CategoryChip({
  kind,
  value,
  filters,
}: {
  kind: keyof typeof META;
  value: string;
  filters: ProductFilters;
}) {
  const { label } = META[kind];
  const patch =
    kind === 'category1' ? { seg: 'all' as const }
    : kind === 'category2' ? { category2: null }
    : kind === 'category3' ? { category3: null }
    : { emotion: 'all' as const };
  return (
    <span
      data-hint={`${label} 필터: ${value} · × 클릭하여 해제`}
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
        data-hint="이 필터 해제"
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
