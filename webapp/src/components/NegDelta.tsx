"use client";

import { useEffect, useRef, useState, KeyboardEvent } from 'react';
import type { NegDeltaRow } from '@/lib/queries';
import { DrilldownPanel } from './DrilldownPanel';

type Bucket = 'surge' | 'watch' | 'neutral' | 'good-light' | 'good';

function bucketOf(delta: number | null): Bucket {
  if (delta == null) return 'neutral';
  if (delta >= 10) return 'surge';
  if (delta >= 3) return 'watch';
  if (delta <= -10) return 'good';
  if (delta <= -3) return 'good-light';
  return 'neutral';
}

const BUCKET_STYLE: Record<
  Bucket,
  { bg: string; fg: string; stripe: string; iconColor: string; icon: string; label: string }
> = {
  surge:        { bg: 'var(--surge)',     fg: '#fff',            stripe: 'var(--surge)',       iconColor: 'var(--surge)',    icon: '📈', label: '부정 급증' },
  watch:        { bg: 'var(--watch)',     fg: '#221a08',         stripe: 'var(--watch)',       iconColor: 'var(--watch)',    icon: '↗',  label: '부정 상승' },
  neutral:      { bg: 'var(--panel-2)',   fg: 'var(--text-mute)', stripe: 'var(--border)',      iconColor: 'var(--text-mute)', icon: '·',  label: '안정' },
  'good-light': { bg: 'var(--good-tint)', fg: 'var(--good)',     stripe: 'var(--good)',        iconColor: 'var(--good)',      icon: '↘',  label: '부정 감소' },
  good:         { bg: 'var(--good)',      fg: '#fff',            stripe: 'var(--good)',        iconColor: 'var(--good)',      icon: '📉', label: '부정 크게 개선' },
};

type Drill = { category1: string | null; category2: string } | null;

export function NegDelta({ rows }: { rows: NegDeltaRow[] }) {
  const [drill, setDrill] = useState<Drill>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (drill && panelRef.current) {
      panelRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [drill]);

  if (rows.length === 0) {
    return (
      <div style={{ color: 'var(--text-mute)', fontSize: 12, padding: 16 }}>
        데이터 없음 (7일 ≥5 AND 28일 ≥20 조건 미달)
      </div>
    );
  }

  function toggleDrill(row: NegDeltaRow, isSelected: boolean) {
    setDrill(
      isSelected
        ? null
        : {
            category1: row.category1 && row.category1 !== '(미분류)' ? row.category1 : null,
            category2: row.category2,
          }
    );
  }

  return (
    <>
      <div style={{ display: 'grid', gap: 4 }}>
        {rows.map(r => {
          const bucket = bucketOf(r.delta_pp);
          const style = BUCKET_STYLE[bucket];
          const deltaText =
            r.delta_pp == null
              ? '—'
              : `${r.delta_pp > 0 ? '+' : ''}${r.delta_pp.toFixed(1)}%p`;

          const isSelected =
            drill != null &&
            drill.category2 === r.category2 &&
            drill.category1 === (r.category1 !== '(미분류)' ? r.category1 : null);

          const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleDrill(r, isSelected);
            }
          };

          return (
            <div
              key={`${r.category1}-${r.category2}`}
              role="button"
              tabIndex={0}
              aria-expanded={isSelected}
              aria-label={`부정 감정 드릴다운 ${r.category1} / ${r.category2}`}
              onClick={() => toggleDrill(r, isSelected)}
              onKeyDown={onKey}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto minmax(0, 1fr) minmax(0, 1fr) auto',
                gap: 12,
                alignItems: 'center',
                padding: '10px 14px',
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderLeft: `3px solid ${style.stripe}`,
                borderRadius: 6,
                cursor: 'pointer',
                outline: isSelected ? '2px solid var(--accent)' : 'none',
                outlineOffset: -1,
              }}
            >
              <span
                aria-label={style.label}
                title={style.label}
                style={{
                  width: 22, height: 22,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 700,
                  color: style.iconColor,
                }}
              >
                {style.icon}
              </span>

              <div style={{ fontSize: 13.5 }}>
                <span style={{ color: 'var(--text-mute)', fontSize: 11, marginRight: 6 }}>
                  {r.category1}
                </span>
                <span style={{ color: 'var(--text)', fontWeight: 500 }}>{r.category2}</span>
              </div>

              <div style={{
                fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--text-dim)',
                display: 'flex', gap: 8, alignItems: 'baseline',
                whiteSpace: 'nowrap',
              }}>
                <span
                  title={`최근 7일: ${r.recent_tickets}건 중 ${r.recent_negative}건이 부정 · ${r.recent_pct?.toFixed(1) ?? '0'}%`}
                  style={{ color: 'var(--text)', cursor: 'help' }}
                >
                  7일 {r.recent_pct?.toFixed(1) ?? '0'}%
                  <span style={{ color: 'var(--text-mute)' }}> ({r.recent_negative}/{r.recent_tickets})</span>
                </span>
                <span style={{ color: 'var(--text-mute)' }}>vs</span>
                <span
                  title={`직전 4주 평시: ${r.baseline_tickets}건 중 ${r.baseline_negative}건이 부정 · ${r.baseline_pct?.toFixed(1) ?? '0'}%`}
                  style={{ cursor: 'help' }}
                >
                  28일 {r.baseline_pct?.toFixed(1) ?? '0'}%
                  <span style={{ color: 'var(--text-mute)' }}> ({r.baseline_negative}/{r.baseline_tickets})</span>
                </span>
              </div>

              <span
                title={
                  r.delta_pp == null
                    ? ''
                    : r.delta_pp > 0
                    ? `최근 부정률이 평시 대비 ${r.delta_pp.toFixed(1)}%p 상승`
                    : `최근 부정률이 평시 대비 ${Math.abs(r.delta_pp).toFixed(1)}%p 하락`
                }
                style={{
                  padding: '3px 10px',
                  borderRadius: 999,
                  background: style.bg,
                  color: style.fg,
                  fontFamily: 'var(--mono)',
                  fontSize: 11.5,
                  fontWeight: 500,
                  minWidth: 62,
                  textAlign: 'center',
                  opacity: bucket === 'neutral' ? 0.55 : 1,
                  whiteSpace: 'nowrap',
                  cursor: 'help',
                }}
              >
                {deltaText}
              </span>
            </div>
          );
        })}
      </div>

      {drill && (
        <div ref={panelRef}>
          <DrilldownPanel
            category1={drill.category1}
            category2={drill.category2}
            category3={null}
            focus="negative"
            onClose={() => setDrill(null)}
          />
        </div>
      )}
    </>
  );
}
