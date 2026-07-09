import Link from 'next/link';
import type { StatusSummaryRow } from '@/lib/queries';
import { buildProductHref, type ProductFilters } from '@/lib/product-url';

const ORDER: Array<StatusSummaryRow['surge_level']> = ['SURGE', 'WATCH', 'STABLE', 'IMPROVED'];

const META: Record<
  StatusSummaryRow['surge_level'],
  { label: string; klass: string; numClass: string; description: string }
> = {
  SURGE:    { label: '급증',   klass: '--surge', numClass: '--surge', description: '평시 대비 ≥2배 · 최근 7일 5건 이상' },
  WATCH:    { label: '주의',   klass: '--watch', numClass: '--watch', description: '평시 대비 ≥1.5배 · 최근 7일 3건 이상' },
  STABLE:   { label: '안정',   klass: '',        numClass: '',        description: '평시 수준 · 정상' },
  IMPROVED: { label: '개선',   klass: '--good',  numClass: '--good',  description: '평시 대비 감소' },
};

export function StatusOverview({
  rows,
  filters,
}: {
  rows: StatusSummaryRow[];
  filters: ProductFilters;
}) {
  const activeLevels = filters.levels;
  const map = new Map(rows.map(r => [r.surge_level, r]));
  const grandTickets = rows.reduce((s, r) => s + Number(r.tickets || 0), 0);
  const activeSet = new Set(activeLevels);

  return (
    <div>
      <div className="kpi-row">
        {ORDER.map(level => {
          const r = map.get(level);
          const cats = Number(r?.categories ?? 0);
          const tk = Number(r?.tickets ?? 0);
          const neg = Number(r?.negative_tickets ?? 0);
          const meta = META[level];
          const share = grandTickets > 0 ? (tk / grandTickets) * 100 : 0;
          const active = activeSet.has(level);
          // 토글: 현재 activeLevels에 level이 있으면 제거, 없으면 추가.
          const nextLevels = active
            ? activeLevels.filter(l => l !== level)
            : [...activeLevels, level];
          const href = buildProductHref({ levels: nextLevels }, filters);
          return (
            <Link
              key={level}
              href={href}
              className={`kpi ${meta.klass}`}
              role="button"
              aria-pressed={active}
              data-hint={`${meta.label} · 클릭하여 상단 필터 ${active ? '해제' : '적용'} (다중 선택 가능)`}
              style={{
                cursor: 'pointer',
                outline: active ? '2px solid var(--accent)' : 'none',
                outlineOffset: -1,
                textDecoration: 'none',
                color: 'inherit',
                display: 'block',
                transition: 'transform .12s',
              }}
            >
              <div className="lbl">
                {meta.label}
                {active && <span style={{ color: 'var(--accent)', marginLeft: 6 }}>✓</span>}
              </div>
              <div className={`num ${meta.numClass}`}>
                {cats}<em style={{ fontSize: 14, marginLeft: 6, color: 'var(--text-mute)' }}>개 카테고리</em>
              </div>
              <div className="meta" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span data-hint={`이 상태 카테고리 전체의 최근 7일 티켓 합계 · 전체 대비 ${share.toFixed(0)}%`}>
                  <b style={{ color: 'var(--text-dim)' }}>{tk.toLocaleString()}</b>
                  <span style={{ color: 'var(--text-mute)' }}>건 · 최근 7일</span>
                  {tk > 0 && (
                    <span style={{ color: 'var(--text-mute)' }}>
                      {' · '}{share.toFixed(0)}%
                    </span>
                  )}
                </span>
                {neg > 0 && (
                  <span
                    data-hint="이 중 부정 감정으로 분류된 티켓 수"
                    style={{ color: 'var(--surge)', fontFamily: 'var(--mono)', fontSize: 11 }}
                  >
                    부정 {neg}
                  </span>
                )}
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-mute)' }}>
                {meta.description}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
