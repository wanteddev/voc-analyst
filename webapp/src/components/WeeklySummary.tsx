import Link from 'next/link';
import type { WeeklyInsights, InsightSeverity } from '@/lib/insights';
import { buildProductHref, type ProductFilters } from '@/lib/product-url';
import { windowLabel } from '@/lib/queries';

// 주간 요약 인사이트 카드 — 항상 서비스 전체 기준 (현재 필터와 무관).
// LLM 서술 한 줄(있으면) + 규칙 기반 인사이트 칩. 칩 클릭 시 해당 필터로 이동.

const SEV_COLOR: Record<InsightSeverity, string> = {
  surge: 'var(--surge)',
  watch: 'var(--watch)',
  good: 'var(--good)',
  neutral: 'var(--text-dim)',
};

export function WeeklySummary({
  insights,
  asOf,
}: {
  insights: WeeklyInsights;
  asOf: string;
}) {
  const { items, narrative } = insights;
  if (items.length === 0) return null;

  // 칩 링크는 필터 무관한 깨끗한 base에서 조합 (요약은 whole-service이므로).
  const base: ProductFilters = {
    seg: 'all',
    levels: [],
    emotion: 'all',
    category2: null,
    category3: null,
    asOf,
  };

  return (
    <section className="card">
      <div className="section-hdr">
        <h2
          data-hint="현재 필터와 무관하게 서비스 전체 기준으로 이번 주 주목할 신호를 요약합니다."
          style={{ cursor: 'help' }}
        >
          이번 주 요약
        </h2>
        <span className="hint">서비스 전체 · {windowLabel(asOf, 7)}</span>
      </div>

      {narrative && (
        <p
          style={{
            margin: '2px 0 12px',
            fontSize: 14,
            lineHeight: 1.5,
            color: 'var(--text)',
            fontWeight: 500,
          }}
        >
          {narrative}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((item, i) => {
          const color = SEV_COLOR[item.severity];
          const inner = (
            <>
              <span style={{ flexShrink: 0 }}>{item.icon}</span>
              <span
                style={{
                  width: 3,
                  alignSelf: 'stretch',
                  borderRadius: 2,
                  background: color,
                  flexShrink: 0,
                }}
              />
              <span style={{ color: 'var(--text-dim)' }}>{item.text}</span>
            </>
          );
          const style: React.CSSProperties = {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 10px',
            borderRadius: 6,
            background: 'var(--panel-2)',
            border: '1px solid var(--border)',
            fontSize: 12.5,
            textDecoration: 'none',
          };
          return item.link ? (
            <Link
              key={i}
              href={buildProductHref(item.link, base)}
              style={{ ...style, cursor: 'pointer', color: 'inherit' }}
              data-hint="클릭 → 상단 필터에 반영해 상세 보기"
            >
              {inner}
            </Link>
          ) : (
            <div key={i} style={style}>
              {inner}
            </div>
          );
        })}
      </div>
    </section>
  );
}
