"use client";

import { useRef, useEffect, KeyboardEvent, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { DrilldownPanel } from './DrilldownPanel';
import { buildProductHref, type ProductFilters } from '@/lib/product-url';

type SurgeItem = {
  surge_level: 'SURGE' | 'WATCH' | 'IMPROVED' | 'STABLE';
  category1: string;
  category2: string;
  category3: string;
  recent_7d: number;
  baseline_daily_avg: number;
  ratio: number;
  recent_negative_ratio: number | null;
};

export function WatchGrid({
  surges,
  filters,
}: {
  surges: SurgeItem[];
  filters: ProductFilters;
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);

  // Drill 상태는 URL의 cat2/cat3에서 파생 — 카드 클릭 = URL push, chip × = URL 제거.
  const drill = useMemo(() => {
    if (!filters.category2) return null;
    return {
      category1: filters.seg === 'user' ? '유저' : filters.seg === 'company' ? '기업' : null,
      category2: filters.category2,
      category3: filters.category3,
    };
  }, [filters]);

  useEffect(() => {
    if (drill && panelRef.current) {
      panelRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [drill]);

  function onCardClick(s: SurgeItem, isSelected: boolean) {
    if (isSelected) {
      // 같은 카드 재클릭 = drilldown 닫기 + URL에서 cat2/cat3 제거
      router.push(buildProductHref({ category2: null, category3: null }, filters));
      return;
    }
    router.push(buildProductHref({
      category2: s.category2,
      category3: s.category3 && s.category3 !== '(미분류)' ? s.category3 : null,
    }, filters));
  }

  return (
    <div>
      <div className="watch-grid">
        {surges.map(s => {
          const isSelected =
            drill &&
            drill.category2 === s.category2 &&
            drill.category3 === (s.category3 !== '(미분류)' ? s.category3 : null);
          const levelClass =
            s.surge_level === 'SURGE' ? '--surge'
            : s.surge_level === 'IMPROVED' ? '--good'
            : s.surge_level === 'STABLE' ? '--stable'
            : '';
          const ratioColor =
            s.surge_level === 'SURGE' ? 'var(--surge)'
            : s.surge_level === 'IMPROVED' ? 'var(--good)'
            : s.surge_level === 'STABLE' ? 'var(--text-dim)'
            : 'var(--watch)';

          const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onCardClick(s, !!isSelected);
            }
          };

          return (
            <div
              key={`${s.category1}-${s.category2}-${s.category3}`}
              className={`watch-item ${levelClass}`}
              role="button"
              tabIndex={0}
              aria-expanded={!!isSelected}
              aria-label={`드릴다운 + 필터 ${s.category2} / ${s.category3}`}
              title={
                isSelected
                  ? '클릭하여 이 카테고리 필터·드릴다운 해제'
                  : '클릭 → 상단 필터에 이 카테고리 추가 + 드릴다운 오픈'
              }
              onClick={() => onCardClick(s, !!isSelected)}
              onKeyDown={onKey}
              style={{
                cursor: 'pointer',
                outline: isSelected ? '2px solid var(--accent)' : 'none',
                outlineOffset: -1,
              }}
            >
              <div className="cat">
                {s.category2 || '—'} <span className="p">/</span> {s.category3 || '—'}
              </div>
              <div className="ratio" style={{ color: ratioColor }} title={`평시 대비 ${s.ratio.toFixed(2)}배`}>{s.ratio.toFixed(2)}×</div>
              <div
                className="footline"
                title={`이 카테고리 최근 7일간 ${s.recent_7d}건 · 지난 4주 하루 평균 ${s.baseline_daily_avg.toFixed(2)}건`}
              >
                <span>최근 7일 {s.recent_7d}건 · 평시 {s.baseline_daily_avg.toFixed(2)}건/일</span>
                <span className={s.recent_negative_ratio && s.recent_negative_ratio > 0.2 ? 'neg' : ''}>
                  {s.recent_negative_ratio != null
                    ? `부정 ${(s.recent_negative_ratio * 100).toFixed(0)}%`
                    : '—'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {drill && (
        <div ref={panelRef}>
          <DrilldownPanel
            category1={drill.category1}
            category2={drill.category2}
            category3={drill.category3}
            onClose={() =>
              router.push(buildProductHref({ category2: null, category3: null }, filters))
            }
          />
        </div>
      )}
    </div>
  );
}
