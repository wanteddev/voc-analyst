"use client";

import { useEffect, useMemo, useState } from 'react';
import { TrendChart } from './TrendChart';

type TrendPoint = { week: { value: string }; tickets: number; negative_tickets: number };
type Keyword = { keyword: string; mentions: number; negative_mentions: number };
type Ticket = {
  id: string;
  event_create_time: { value: string };
  category3: string;
  main_topic: string;
  title: string;
  overall_emotion: string;
  detail_preview: string;
};

type KeywordTrendPoint = { week: { value: string }; mentions: number; negative_mentions: number };
type Data = {
  trend: TrendPoint[];
  keywords: Keyword[];
  tickets: Ticket[];
  keywordTrend?: KeywordTrendPoint[] | null;
};
type Focus = 'volume' | 'negative';

export function DrilldownPanel({
  category1,
  category2,
  category3,
  focus = 'volume',
  onClose,
}: {
  category1: string | null;
  category2: string;
  category3: string | null;
  focus?: Focus;
  onClose: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // 크로스 필터: 주간 포인트 선택 + 키워드 선택. 조합 가능.
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null);

  async function copyToClipboard(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId(prev => (prev === id ? null : prev));
      }, 1500);
    } catch (e) {
      console.error('clipboard copy failed', e);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setErr(null);
    const qs = new URLSearchParams();
    if (category1) qs.set('category1', category1);
    qs.set('category2', category2);
    if (category3) qs.set('category3', category3);
    if (focus === 'negative') qs.set('focus', 'negative');
    if (weekStart) qs.set('weekStart', weekStart);
    if (selectedKeyword) qs.set('keyword', selectedKeyword);

    fetch(`/api/drilldown?${qs.toString()}`)
      .then(async r => {
        const text = await r.text();
        try {
          const j = JSON.parse(text);
          if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
          return j as Data;
        } catch (parseErr) {
          if (parseErr instanceof SyntaxError) {
            throw new Error(
              r.status >= 500
                ? `서버가 응답하지 않아요 (HTTP ${r.status}). 잠시 후 다시 시도해주세요.`
                : `서버 응답을 읽을 수 없습니다 (HTTP ${r.status}). 새로고침해주세요.`
            );
          }
          throw parseErr;
        }
      })
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [category1, category2, category3, focus, weekStart, selectedKeyword]);

  // 카테고리 변경 시 크로스 필터 초기화
  useEffect(() => {
    setWeekStart(null);
    setSelectedKeyword(null);
  }, [category1, category2, category3]);

  const label = category3 ? `${category2} / ${category3}` : `${category2} (전체 하위 category3)`;
  const isNeg = focus === 'negative';
  const headerText = isNeg ? `부정 감정 드릴다운: ${label}` : `드릴다운: ${label}`;
  const cardClass = isNeg ? 'card --surge' : 'card';

  // 키워드 선택 시: 해당 키워드 언급 추이. 아니면 카테고리 티켓/부정률 추이.
  const isKeywordChart = !!(selectedKeyword && data?.keywordTrend && data.keywordTrend.length > 0);
  const trendPoints = useMemo(() => {
    if (!data) return [];
    if (isKeywordChart && data.keywordTrend) {
      return data.keywordTrend.map(p => ({ x: p.week.value.slice(5), y: Number(p.mentions) }));
    }
    if (isNeg) {
      return data.trend.map(p => ({
        x: p.week.value.slice(5),
        y: p.tickets > 0
          ? Math.round((Number(p.negative_tickets) / Number(p.tickets)) * 1000) / 10
          : 0,
      }));
    }
    return data.trend.map(p => ({ x: p.week.value.slice(5), y: Number(p.tickets) }));
  }, [data, isNeg, isKeywordChart]);

  // 차트 포인트 클릭용 주차 목록 — 키워드 차트일 땐 keywordTrend 기준
  const chartWeeks = useMemo(() => {
    if (!data) return [];
    if (isKeywordChart && data.keywordTrend) return data.keywordTrend.map(p => p.week.value);
    return data.trend.map(p => p.week.value);
  }, [data, isKeywordChart]);

  // 키워드: volume이면 mentions desc (그대로), negative면 neg desc + neg>0만
  const displayKeywords = useMemo(() => {
    if (!data) return [];
    if (isNeg) {
      return data.keywords
        .filter(k => k.negative_mentions > 0)
        .sort((a, b) => b.negative_mentions - a.negative_mentions);
    }
    return data.keywords;
  }, [data, isNeg]);

  const trendEyebrow = isNeg
    ? '주간 부정률 (%) · 12주 창'
    : '주간 티켓 추이 · 12주 창';
  const keywordEyebrow = isNeg
    ? `부정 키워드 · 12주 창 · 회색 = 총 언급 · 빨강 = 부정 티켓 내 언급 ${category3 ? '' : '(category3 지정 시)'}`
    : `상위 키워드 · 12주 창 · 회색 = 총 언급 · 빨강 = 부정 티켓 내 언급 ${category3 ? '' : '(category3 지정 시)'}`;
  const ticketsEyebrow = isNeg
    ? '부정 티켓 · 12주 창'
    : '원문 티켓 · 12주 창 (부정 우선)';

  return (
    <div className={cardClass} style={{ marginTop: 12 }}>
      <div className="section-hdr">
        <h2>{headerText}</h2>
        <button onClick={onClose}
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--text-mute)', cursor: 'pointer',
                  fontSize: 18, padding: '2px 8px',
                }}
                aria-label="닫기">×</button>
      </div>

      {err && (
        <div style={{ color: 'var(--surge)', fontSize: 12, padding: '8px 0' }}>
          ❌ {err}
        </div>
      )}
      {!err && !data && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
            gap: 14,
          }}>
            <div>
              <div style={{
                width: 140, height: 10, borderRadius: 4,
                background: 'var(--panel-2)', marginBottom: 12,
              }} className="skeleton-pulse" />
              <div style={{
                width: '100%', height: 200, borderRadius: 6,
                background: 'var(--panel-2)',
              }} className="skeleton-pulse" />
            </div>
            <div>
              <div style={{
                width: 200, height: 10, borderRadius: 4,
                background: 'var(--panel-2)', marginBottom: 12,
              }} className="skeleton-pulse" />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} style={{
                    width: 70 + (i % 3) * 20, height: 22, borderRadius: 999,
                    background: 'var(--panel-2)',
                  }} className="skeleton-pulse" />
                ))}
              </div>
            </div>
          </div>
          <div>
            <div style={{
              width: 220, height: 10, borderRadius: 4,
              background: 'var(--panel-2)', marginBottom: 12,
            }} className="skeleton-pulse" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{
                width: '100%', height: 34, borderRadius: 4,
                background: 'var(--panel-2)', marginBottom: 2,
              }} className="skeleton-pulse" />
            ))}
          </div>
          <style>{`
            @keyframes skel-pulse {
              0%,100% { opacity: 0.55; }
              50%     { opacity: 1; }
            }
            .skeleton-pulse { animation: skel-pulse 1.4s ease-in-out infinite; }
          `}</style>
        </div>
      )}
      {data && (
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Trend + Keywords side by side */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
            gap: 14,
          }}>
            <div>
              <div className="eyebrow">
                {isKeywordChart
                  ? <>{'\''}{selectedKeyword}{'\''} 주간 언급 추이 · 12주 창</>
                  : trendEyebrow}
                {' · '}
                <span style={{ color: 'var(--text-dim)' }}>포인트 클릭 → 그 주로 필터</span>
              </div>
              <TrendChart
                points={trendPoints}
                color={isKeywordChart ? 'var(--watch)' : isNeg ? 'var(--surge)' : 'var(--accent)'}
                yFormat={!isKeywordChart && isNeg ? v => `${v}%` : undefined}
                ariaLabel={
                  isKeywordChart
                    ? `'${selectedKeyword}' 주간 언급 트렌드`
                    : `${label} ${isNeg ? '주간 부정률' : '주간 티켓'} 트렌드`
                }
                activeIndex={
                  weekStart ? chartWeeks.findIndex(w => w === weekStart) : null
                }
                onPointClick={(i) => {
                  const w = chartWeeks[i];
                  if (!w) return;
                  setWeekStart(prev => (prev === w ? null : w));
                }}
              />
            </div>
            <div>
              <div className="eyebrow">
                {weekStart
                  ? `상위 키워드 · ${weekStart.slice(5)} 주간`
                  : keywordEyebrow}
                {' · '}
                <span style={{ color: 'var(--text-dim)' }}>키워드 클릭 → 차트·티켓 필터</span>
              </div>
              {displayKeywords.length === 0 ? (
                <p style={{ color: 'var(--text-mute)', fontSize: 12 }}>
                  {category3 ? (isNeg ? '부정 키워드 없음' : '키워드 없음') : 'category3 카드 클릭 시 키워드 표시'}
                </p>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {displayKeywords.map(k => {
                    const negPct = k.mentions > 0
                      ? Math.round((k.negative_mentions / k.mentions) * 100)
                      : 0;
                    const isSel = selectedKeyword === k.keyword;
                    const tip = isSel
                      ? `'${k.keyword}' 필터 해제`
                      : k.negative_mentions > 0
                      ? `'${k.keyword}' — 총 ${k.mentions}회 언급 · 부정 티켓에서 ${k.negative_mentions}회 (${negPct}%) · 클릭하여 필터`
                      : `'${k.keyword}' — 총 ${k.mentions}회 언급 · 클릭하여 필터`;
                    return (
                      <button
                        key={k.keyword}
                        title={tip}
                        onClick={() =>
                          setSelectedKeyword(prev => (prev === k.keyword ? null : k.keyword))
                        }
                        style={{
                          padding: '4px 10px', borderRadius: 999,
                          background: isSel ? 'var(--panel)' : 'var(--panel-2)',
                          border: '1px solid var(--border)',
                          borderLeftColor: k.negative_mentions > 0 ? 'var(--surge)' : 'var(--border)',
                          borderLeftWidth: k.negative_mentions > 0 ? 3 : 1,
                          outline: isSel ? '2px solid var(--accent)' : 'none',
                          outlineOffset: -1,
                          fontSize: 11.5, fontFamily: 'var(--mono)',
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          cursor: 'pointer',
                        }}
                      >
                        <span style={{ color: 'var(--text)' }}>{k.keyword}</span>
                        <span style={{ color: 'var(--text-mute)' }}>{k.mentions}회</span>
                        {k.negative_mentions > 0 && (
                          <span style={{ color: 'var(--surge)' }}>부정 {k.negative_mentions}</span>
                        )}
                        {isSel && <span style={{ color: 'var(--accent)' }}>✓</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Tickets */}
          <div>
            <div className="eyebrow" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>
                {weekStart || selectedKeyword
                  ? [
                      isNeg ? '부정 티켓' : '원문 티켓',
                      weekStart ? `${weekStart.slice(5)} 주간` : null,
                      selectedKeyword ? `'${selectedKeyword}' 포함` : null,
                    ].filter(Boolean).join(' · ')
                  : ticketsEyebrow}
              </span>
              {weekStart && (
                <button
                  onClick={() => setWeekStart(null)}
                  style={{
                    padding: '2px 8px', borderRadius: 4,
                    background: 'var(--panel-2)',
                    border: '1px solid var(--border-strong)',
                    color: 'var(--text-dim)',
                    fontFamily: 'var(--mono)', fontSize: 10,
                    cursor: 'pointer',
                  }}
                  title="주간 필터 해제 (12주 전체)"
                >
                  × {weekStart.slice(5)} 주간
                </button>
              )}
              {selectedKeyword && (
                <button
                  onClick={() => setSelectedKeyword(null)}
                  style={{
                    padding: '2px 8px', borderRadius: 4,
                    background: 'var(--panel-2)',
                    border: '1px solid var(--border-strong)',
                    color: 'var(--text-dim)',
                    fontFamily: 'var(--mono)', fontSize: 10,
                    cursor: 'pointer',
                  }}
                  title="키워드 필터 해제"
                >
                  × {selectedKeyword}
                </button>
              )}
            </div>
            {data.tickets.length === 0 ? (
              <p style={{ color: 'var(--text-mute)', fontSize: 12 }}>
                {isNeg ? '부정 티켓 없음' : '티켓 없음'}
              </p>
            ) : (
              <div className="tk-list" style={{ marginTop: 6 }}>
                {data.tickets.map(t => {
                  const isOpen = expanded.has(t.id);
                  const dot = t.overall_emotion === '부정' ? 'var(--surge)'
                            : t.overall_emotion === '긍정' ? 'var(--good)'
                            : 'var(--text-mute)';
                  return (
                    <div key={t.id}
                         title={isOpen ? '클릭하여 접기' : '클릭하여 원문 펼치기'}
                         onClick={() => {
                           const next = new Set(expanded);
                           if (isOpen) next.delete(t.id); else next.add(t.id);
                           setExpanded(next);
                         }}
                         style={{
                           padding: '10px 4px',
                           borderBottom: '1px solid var(--border)',
                           cursor: 'pointer',
                         }}>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'auto 1fr auto',
                        gap: 12,
                        alignItems: 'baseline',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            display: 'inline-block', width: 6, height: 6, borderRadius: 3,
                            background: dot,
                          }} />
                          <span style={{
                            fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-mute)',
                          }}>
                            {t.event_create_time.value.slice(5, 16).replace('T', ' ')}
                          </span>
                        </div>
                        <div style={{ fontSize: 13.5 }}>
                          {t.main_topic || t.title || '(제목 없음)'}
                        </div>
                        <div style={{
                          fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-dim)',
                        }}>
                          {t.category3}
                        </div>
                      </div>
                      {isOpen && t.detail_preview && (
                        <div style={{
                          marginTop: 8,
                          padding: 10,
                          background: 'var(--panel-2)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          fontSize: 12,
                          color: 'var(--text-dim)',
                          position: 'relative',
                        }}>
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              copyToClipboard(t.id, t.detail_preview);
                            }}
                            aria-label="원문 복사"
                            title={copiedId === t.id ? '복사됨' : '원문 클립보드 복사'}
                            style={{
                              position: 'absolute',
                              top: 6, right: 6,
                              padding: '3px 8px',
                              borderRadius: 4,
                              background: copiedId === t.id ? 'var(--good-tint)' : 'var(--panel)',
                              border: `1px solid ${copiedId === t.id ? 'var(--good)' : 'var(--border-strong)'}`,
                              color: copiedId === t.id ? 'var(--good)' : 'var(--text-dim)',
                              fontSize: 11,
                              fontFamily: 'var(--mono)',
                              cursor: 'pointer',
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              transition: 'background .12s, color .12s',
                            }}
                          >
                            <span aria-hidden style={{ fontSize: 12 }}>
                              {copiedId === t.id ? '✓' : '⧉'}
                            </span>
                            {copiedId === t.id ? '복사됨' : '복사'}
                          </button>
                          <div style={{
                            whiteSpace: 'pre-wrap',
                            maxHeight: 200,
                            overflowY: 'auto',
                            paddingRight: 60,
                          }}>
                            {t.detail_preview}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
