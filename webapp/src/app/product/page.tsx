import {
  fetchAllSurges,
  deriveStatusSummary,
  deriveGridSurges,
  fetchNewKeywords,
  fetchMtdSummary,
  fetchLastDataDate,
  parseAsOfDate,
  windowLabel,
  mtdLabel,
  segToCategory1,
  kstYesterday,
  LEVEL_KEY_TO_SURGE,
  type SegKey,
  type SurgeLevel,
  type EmotionKey,
} from '@/lib/queries';
import Link from 'next/link';
import { buildProductHref, type ProductFilters } from '@/lib/product-url';
import { WatchGrid } from '@/components/WatchGrid';
import { LevelPill } from '@/components/LevelPill';
import { CategoryChip } from '@/components/CategoryChip';
import { EMOTION_LABEL } from '@/lib/level';
import { FilterAdd, type FilterOptions } from '@/components/FilterAdd';
import { StatusOverview } from '@/components/StatusOverview';
import { DateFilter } from '@/components/DateFilter';
import { WeeklySummary } from '@/components/WeeklySummary';
import { LegendPopover } from '@/components/LegendPopover';
import { fetchWeeklyInsights } from '@/lib/insights';

// revalidate 60초 · URL 조합별 캐시 → 필터 반복 클릭 시 BQ 재조회 최소화.
// (일일 quota 초과 방지)
export const revalidate = 60;

type PageProps = {
  searchParams: Promise<{
    seg?: string;
    level?: string;
    emo?: string;
    asOf?: string;
    cat2?: string;
    cat3?: string;
  }>;
};

function parseEmotion(v: string | undefined): EmotionKey {
  if (v === 'negative' || v === 'positive' || v === 'neutral') return v;
  return 'all';
}

function kstToday(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

function parseLevels(v: string | undefined): SurgeLevel[] {
  if (!v || v === 'all') return [];
  const out: SurgeLevel[] = [];
  const seen = new Set<SurgeLevel>();
  for (const raw of v.split(',')) {
    const key = raw.trim() as keyof typeof LEVEL_KEY_TO_SURGE;
    const mapped = LEVEL_KEY_TO_SURGE[key];
    if (mapped && !seen.has(mapped)) {
      seen.add(mapped);
      out.push(mapped);
    }
  }
  return out;
}

function sanitizeCat(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.slice(0, 50).trim();
  return s || null;
}

const LEVEL_HINT: Record<SurgeLevel, string> = {
  SURGE: '급증',
  WATCH: '주의',
  STABLE: '안정',
  IMPROVED: '개선',
};

export default async function ProductInsightsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const seg: SegKey = params.seg === 'user' || params.seg === 'company' ? params.seg : 'all';
  const levels = parseLevels(params.level);
  const emotion = parseEmotion(params.emo);
  const asOf = parseAsOfDate(params.asOf) ?? kstYesterday();
  const category2 = sanitizeCat(params.cat2);
  const category3 = sanitizeCat(params.cat3);
  const category1 = segToCategory1(seg);
  const today = kstToday();

  const filters: ProductFilters = { seg, levels, emotion, category2, category3, asOf };

  // 급증 스냅샷은 카테고리 필터 없이 whole-service(현재 감정)로 한 번만 조회.
  // 카테고리(대/중/소분류) 필터는 in-memory로 적용 → 한 카테고리의 surge_level이
  // KPI·그리드·요약 모든 뷰에서 동일하게 유지됨(별도 필터 쿼리가 다른 시점에 캐시돼
  // 경계값 카테고리가 뷰마다 SURGE↔WATCH로 갈리던 문제 제거). emotion=all이면
  // WeeklySummary 내부 스냅샷과 키가 같아 single-flight로 BQ 1회만 실행.
  const [snapshot, newKeywords, mtd, lastDataDate, weeklyInsights] = await Promise.all([
    fetchAllSurges(null, asOf, null, null, emotion),
    fetchNewKeywords(category1, asOf, category3),
    fetchMtdSummary(asOf, category1, category2, category3, emotion),
    fetchLastDataDate(),
    fetchWeeklyInsights(asOf), // whole-service (필터 무관) — Redis 캐시로 마진 비용 최소
  ]);
  const scoped = snapshot.filter(s =>
    (category1 == null || s.category1 === category1) &&
    (category2 == null || s.category2 === category2) &&
    (category3 == null || s.category3 === category3)
  );
  const statusSummary = deriveStatusSummary(scoped);
  const gridSurges = deriveGridSurges(scoped, levels);

  // FilterAdd 팝오버 값 목록 — 전체 스냅샷 기준 distinct (현재 필터와 무관하게 선택 가능)
  const filterOptions: FilterOptions = (() => {
    const agg = (key: 'category1' | 'category2' | 'category3') => {
      const map = new Map<string, number>();
      for (const s of snapshot) {
        const v = s[key];
        if (!v || v === '(미분류)') continue;
        map.set(v, (map.get(v) ?? 0) + Number(s.recent_7d || 0));
      }
      return Array.from(map.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count);
    };
    return { category1: agg('category1'), category2: agg('category2'), category3: agg('category3') };
  })();

  const segLabel = seg === 'user' ? '유저' : seg === 'company' ? '기업' : null;
  // 기준일(asOf) 외 모든 필터가 하나라도 활성이면 '전체 해제' 노출
  const hasActiveFilters =
    seg !== 'all' || levels.length > 0 || emotion !== 'all' || !!category2 || !!category3;

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <p className="eyebrow" style={{ margin: 0 }}>Product Insights — 프로덕트 이슈 발굴</p>
        {lastDataDate && (
          <span
            data-hint="데이터 파이프라인에 반영된 마지막 날짜. 새 티켓은 다음 배치에 반영됩니다."
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '3px 8px', borderRadius: 4,
              background: 'var(--panel-2)',
              border: '1px solid var(--border)',
              fontFamily: 'var(--mono)', fontSize: 10.5,
              color: 'var(--text-dim)',
              letterSpacing: '0.02em',
            }}
          >
            <span style={{
              display: 'inline-block', width: 6, height: 6, borderRadius: 3,
              background: 'var(--good)',
            }} />
            데이터 최신 반영 · {lastDataDate}
          </span>
        )}
        <LegendPopover />
      </div>

      <div className="filter-sticky">
        <span
          className="label"
          data-hint="pill·chip을 조합해 범위를 좁혀보세요. + 로 분류 필터를 추가하고, chip의 ×로 해제합니다."
          style={{ cursor: 'help' }}
        >필터</span>
        <FilterAdd filters={filters} options={filterOptions} />
        <LevelPill filters={filters} summary={statusSummary} />
        {segLabel && <CategoryChip kind="category1" value={segLabel} filters={filters} />}
        {category2 && <CategoryChip kind="category2" value={category2} filters={filters} />}
        {category3 && <CategoryChip kind="category3" value={category3} filters={filters} />}
        {emotion !== 'all' && (
          <CategoryChip kind="emotion" value={EMOTION_LABEL[emotion]} filters={filters} />
        )}
        {hasActiveFilters && (
          <Link
            href={buildProductHref(
              { seg: 'all', levels: [], emotion: 'all', category2: null, category3: null },
              filters
            )}
            data-hint="모든 필터 해제 (기준일은 유지)"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              height: 30, boxSizing: 'border-box',
              padding: '0 10px', borderRadius: 6,
              border: '1px solid var(--border-strong)', background: 'var(--panel-2)',
              color: 'var(--text-dim)', fontSize: 11, fontFamily: 'var(--mono)',
              textDecoration: 'none',
            }}
          >
            전체 해제
          </Link>
        )}
        <DateFilter filters={filters} today={today} />
      </div>

      {mtd && (
        <div
          data-hint="이번 달 1일부터 기준일까지 누적된 티켓 수 · 전월 동기간과 비교"
          style={{
            fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-dim)',
            cursor: 'help',
          }}
        >
          <b style={{ color: 'var(--text)' }}>{mtdLabel(asOf)} {Number(mtd.mtd || 0).toLocaleString()}건</b>
          {mtd.prev_same_period ? (
            <>
              {' · 전월 동기간 대비 '}
              <span style={{
                color:
                  mtd.mom_pct == null ? 'var(--text-mute)' :
                  mtd.mom_pct > 0 ? 'var(--surge)' : 'var(--good)',
              }}>
                {mtd.mom_pct == null ? '—' : `${mtd.mom_pct > 0 ? '+' : ''}${mtd.mom_pct}%`}
              </span>
            </>
          ) : null}
          {mtd.mtd
            ? ` · 부정 ${((Number(mtd.mtd_negative || 0) / Number(mtd.mtd)) * 100).toFixed(1)}%`
            : null}
        </div>
      )}

      <WeeklySummary insights={weeklyInsights} asOf={asOf} />

      <section>
        <div className="section-hdr">
          <h2 data-hint="최근 7일 티켓 수를 직전 4주 평시와 비교해 카테고리별 상태(급증/주의/안정/개선)를 분류"
              style={{ cursor: 'help' }}>주간 시그널 · 7일 창</h2>
          <span className="hint">
            {windowLabel(asOf, 7)} · 블럭 클릭 → 상단 필터에 반영 (다중 선택 가능)
          </span>
        </div>
        <StatusOverview rows={statusSummary} filters={filters} />
      </section>

      <section>
        <div className="section-hdr" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <h2 data-hint="급증한 순서로 카테고리 정렬. 카드 클릭 시 상세 드릴다운 오픈 + 상단 필터에 중/소분류 추가"
              style={{ marginRight: 8, cursor: 'help' }}>카테고리 목록 · 7일 창</h2>
          <span className="hint" style={{ marginLeft: 'auto' }}>
            {gridSurges.length}건 · 카드 클릭 → 상단 필터에 중/소분류 추가
            {levels.length > 0 && ` · ${levels.map(l => LEVEL_HINT[l]).join(' + ')} 만`}
          </span>
        </div>
        <WatchGrid surges={gridSurges} filters={filters} />
      </section>

      <section className="card">
        <div className="section-hdr">
          <h2 data-hint="직전 2주엔 거의 없던 새로운 키워드가 최근 2주에 자주 등장한 것들"
              style={{ cursor: 'help' }}>신규 등장 키워드 · 2주 창</h2>
          <span className="hint">직전 2주 언급 2회 미만 · 최근 2주 언급 3회 이상</span>
        </div>
        {newKeywords.length === 0 ? (
          <p style={{ color: 'var(--text-mute)', fontSize: 12 }}>신규 키워드 없음.</p>
        ) : (
          <div className="kw-grid">
            {newKeywords.map(k => (
              <div key={k.keyword}
                   className={`kw-item ${k.recent_negative > 0 ? '--neg' : ''}`}>
                <div className="kw">{k.keyword}</div>
                <div className="m">
                  {k.recent_mentions}회 언급 · {k.top_category3}
                  {k.recent_negative > 0 && <span> · <span style={{color:'var(--surge)'}}>부정 {k.recent_negative}</span></span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="foot">
        <span>via BigQuery · <code>voc_surge_score</code> · <code>voc_daily</code> · <code>voc_keyword_trend</code></span>
        <span>revalidate 600s</span>
      </div>
    </div>
  );
}
