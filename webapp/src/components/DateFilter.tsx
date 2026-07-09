"use client";

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef } from 'react';
import { buildProductHref, type ProductFilters } from '@/lib/product-url';

type Props = {
  filters: ProductFilters;
  today: string; // "오늘" KST 날짜. 프리셋 계산 기준. 어제(전일자) preset이 default.
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function computePresets(yesterdayStr: string): Array<{ key: string; label: string; asOf: string | null }> {
  const [y, m, d] = yesterdayStr.split('-').map(Number);
  const yesterday = new Date(Date.UTC(y, m - 1, d));
  const daysAgo = (n: number) => {
    const t = new Date(yesterday);
    t.setUTCDate(t.getUTCDate() - n);
    return ymd(t);
  };
  return [
    { key: 'yesterday', label: '어제',   asOf: null },
    { key: '7d',        label: '-1주',   asOf: daysAgo(7) },
    { key: '1mo',       label: '-1개월', asOf: daysAgo(30) },
    { key: '3mo',       label: '-3개월', asOf: daysAgo(90) },
    { key: '6mo',       label: '-6개월', asOf: daysAgo(180) },
  ];
}

export function DateFilter({ filters, today }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const yesterday = useMemo(() => {
    const [y, m, d] = today.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    t.setUTCDate(t.getUTCDate() - 1);
    return ymd(t);
  }, [today]);
  const presets = useMemo(() => computePresets(yesterday), [yesterday]);
  // filters.asOf가 default(어제)와 같으면 asOf param 없음으로 처리, 즉 URL currentAsOf = null
  const currentAsOfNorm = filters.asOf === yesterday ? null : filters.asOf;
  const currentKey = presets.find(p => p.asOf === currentAsOfNorm)?.key
    ?? (currentAsOfNorm ? 'custom' : 'yesterday');
  const displayDate = currentAsOfNorm ?? yesterday;

  const minDate = useMemo(() => {
    const [y, m, d] = yesterday.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    t.setUTCDate(t.getUTCDate() - 180);
    return ymd(t);
  }, [yesterday]);

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    if (!v) return;
    const asOf = v === yesterday ? null : v;
    router.push(buildProductHref({ asOf }, filters));
  }

  return (
    <div style={{
      display: 'inline-flex', gap: 2, marginLeft: 'auto', alignItems: 'center',
      height: 30, boxSizing: 'border-box',
      padding: '0 3px',
      background: 'var(--panel)',
      border: '1px solid var(--border)',
      borderRadius: 8,
    }}>
      {presets.map(p => {
        const active = currentKey === p.key;
        return (
          <Link
            key={p.key}
            href={buildProductHref({ asOf: p.asOf }, filters)}
            data-hint={p.asOf ? `기준일 · ${p.asOf}` : '어제 기준'}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 500,
              color: active ? 'var(--text)' : 'var(--text-dim)',
              background: active ? 'var(--panel-2)' : 'transparent',
              transition: 'color .12s, background .12s',
              textDecoration: 'none',
            }}
          >
            {p.label}
          </Link>
        );
      })}
      <label
        data-hint="기준 시점 직접 선택 (최근 180일 이내, 최대 어제까지)"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          marginLeft: 4,
          padding: '4px 8px',
          borderRadius: 6,
          background: currentKey === 'custom' ? 'var(--panel-2)' : 'transparent',
          fontSize: 11,
          fontFamily: 'var(--mono)',
          color: currentKey === 'custom' ? 'var(--text)' : 'var(--text-mute)',
          cursor: 'pointer',
        }}
      >
        <input
          ref={inputRef}
          type="date"
          className="date-input-bare"
          value={displayDate}
          min={minDate}
          max={yesterday}
          onChange={handlePick}
          aria-label="기준 시점 직접 선택"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'inherit',
            fontFamily: 'var(--mono)',
            fontSize: 11,
            padding: 0,
            outline: 'none',
            cursor: 'pointer',
          }}
        />
        <span
          aria-hidden
          onClick={(e) => {
            e.preventDefault();
            inputRef.current?.showPicker?.();
          }}
          style={{ fontSize: 14, lineHeight: 1, cursor: 'pointer' }}
        >
          🗓️
        </span>
      </label>
    </div>
  );
}
