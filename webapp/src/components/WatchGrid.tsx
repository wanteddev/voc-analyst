"use client";

import { useRef, useEffect, KeyboardEvent, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { DrilldownPanel } from './DrilldownPanel';
import { buildProductHref, type ProductFilters } from '@/lib/product-url';
import { track } from '@/lib/track-client';

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
    // 카드의 유저/기업(category1)도 seg에 반영 — 같은 중/소분류가 유저·기업 양쪽에
    // 존재할 때 두 카드가 동시에 선택돼 보이는 모호함 제거.
    const seg: 'all' | 'user' | 'company' =
      s.category1 === '유저' ? 'user' : s.category1 === '기업' ? 'company' : filters.seg;
    track('drilldown_open', { detail: `${s.category1}/${s.category2}/${s.category3}` });
    router.push(buildProductHref({
      seg,
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
                {s.category1 && s.category1 !== '(미분류)' && (
                  <span style={{
                    fontSize: 10.5,
                    fontFamily: 'var(--mono)',
                    color: 'var(--text-mute)',
                    marginRight: 6,
                    padding: '1px 6px',
                    borderRadius: 4,
                    background: 'var(--panel-2)',
                    border: '1px solid var(--border)',
                    verticalAlign: 'middle',
                  }}>
                    {s.category1}
                  </span>
                )}
                {s.category2 || '—'} <span className="p">/</span> {s.category3 || '—'}
              </div>
              <div className="count" title={`최근 7일간 접수된 문의 수`}>
                {s.recent_7d}<em>건 · 최근 7일</em>
              </div>
              <div className="ratio" style={{ color: ratioColor }} title={`평시 대비 ${s.ratio.toFixed(2)}배`}>{s.ratio.toFixed(2)}×</div>
              <div
                className="footline"
                title={`지난 4주 하루 평균 ${s.baseline_daily_avg.toFixed(2)}건`}
              >
                <span>평시 {s.baseline_daily_avg.toFixed(2)}건/일</span>
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
            asOf={filters.asOf}
            onClose={() =>
              router.push(buildProductHref({ category2: null, category3: null }, filters))
            }
          />
        </div>
      )}
    </div>
  );
}
