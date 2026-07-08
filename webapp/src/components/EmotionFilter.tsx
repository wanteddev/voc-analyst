import Link from 'next/link';
import { EMOTION_LABEL, type EmotionKey } from '@/lib/level';
import { buildProductHref, type ProductFilters } from '@/lib/product-url';

// 감정 필터 pill (단일 선택). 전체/부정/긍정/중립.
// 색: 부정=surge(빨강), 긍정=good(초록), 중립=text-dim.

const ITEMS: EmotionKey[] = ['all', 'negative', 'positive', 'neutral'];

const ACTIVE_COLOR: Record<EmotionKey, string> = {
  all: 'var(--text)',
  negative: 'var(--surge)',
  positive: 'var(--good)',
  neutral: 'var(--text)',
};

export function EmotionFilter({ filters }: { filters: ProductFilters }) {
  return (
    <div style={{
      display: 'inline-flex', gap: 2,
      padding: 3,
      background: 'var(--panel)',
      border: '1px solid var(--border)',
      borderRadius: 8,
    }}>
      {ITEMS.map(key => {
        const active = filters.emotion === key;
        return (
          <Link
            key={key}
            href={buildProductHref({ emotion: key }, filters)}
            title={
              key === 'all'
                ? '모든 감정의 문의 표시'
                : `${EMOTION_LABEL[key]} 감정으로 분류된 문의만 표시`
            }
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 500,
              color: active ? ACTIVE_COLOR[key] : 'var(--text-dim)',
              background: active ? 'var(--panel-2)' : 'transparent',
              transition: 'color .12s, background .12s',
              textDecoration: 'none',
            }}
          >
            {EMOTION_LABEL[key]}
          </Link>
        );
      })}
    </div>
  );
}
