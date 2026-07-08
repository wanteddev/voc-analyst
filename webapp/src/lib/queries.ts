import { query } from './bq';

// ────────────────────────────────────────────────────────────────────
// Segment filter helper — 서비스 카테고리1('유저'|'기업')로 스코프 좁힘
// ────────────────────────────────────────────────────────────────────

export type SegKey = 'all' | 'user' | 'company';
export function segToCategory1(seg: SegKey | string | undefined | null): string | null {
  if (seg === 'user') return '유저';
  if (seg === 'company') return '기업';
  return null;
}

// ────────────────────────────────────────────────────────────────────
// As-of date helper — 임의 시점 스냅샷 지원
// ────────────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function parseAsOfDate(v: string | undefined | null): string | null {
  if (!v || !DATE_RE.test(v)) return null;
  return v;
}

// KST 어제 (today - 1 day). 데이터가 전일자까지만 반영되므로 default 기준.
export function kstYesterday(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  kst.setUTCDate(kst.getUTCDate() - 1);
  return kst.toISOString().slice(0, 10);
}

// asOf INCLUSIVE 창. asOf null이면 짧은 label, 임의 시점이면 range 명시.
// 창 = [asOf - (days - 1), asOf], asOf 포함.
export function windowLabel(asOf: string | null, days: number): string {
  if (!asOf) return `최근 ${days}일`;
  const end = new Date(`${asOf}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const fmt = (d: Date) => d.toISOString().slice(5, 10);
  return `${fmt(start)} ~ ${fmt(end)} · ${days}일`;
}

// asOf 기준 월누적(MTD) 라벨. "월누적 · YYYY-MM" 형식으로 통일.
export function mtdLabel(asOf: string | null): string {
  const ref = asOf ?? kstYesterday();
  const yyyymm = ref.slice(0, 7);
  return `월누적 · ${yyyymm}`;
}

// 데이터 마트에 반영된 마지막 날짜. 상단 배지에 사용.
export async function fetchLastDataDate(): Promise<string | null> {
  const rows = await query<{ last_date: { value: string } | string | null }>(
    `SELECT MAX(date) AS last_date FROM \`wanted-data.wanted_ml_voc.voc_daily\``
  );
  const raw = rows[0]?.last_date;
  if (!raw) return null;
  return typeof raw === 'string' ? raw : (raw.value ?? null);
}
// 쿼리 파라미터로 넘길 때는 항상 문자열. SQL에서 DATE로 캐스팅.
function asOfParam(asOf: string | null): { asOf: string | null } {
  return { asOf };
}
// SQL 스니펫 — @asOf 를 DATE로 캐스팅 (null이면 어제 KST 기본값).
// 데이터 파이프라인이 전일자까지만 반영하므로 오늘 대신 어제를 default로.
const AS_OF_DATE = `COALESCE(SAFE_CAST(@asOf AS DATE), DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 1 DAY))`;

// ────────────────────────────────────────────────────────────────────
// Level filter for surge grid — 5-way
// ────────────────────────────────────────────────────────────────────

export type { LevelKey, SurgeLevel } from './level';
export { LEVEL_KEY_TO_SURGE, SURGE_TO_LEVEL_KEY } from './level';
import type { SurgeLevel } from './level';

export type SurgeItem = {
  surge_level: 'SURGE' | 'WATCH' | 'IMPROVED' | 'STABLE';
  category1: string;
  category2: string;
  category3: string;
  recent_7d: number;
  recent_7d_negative: number;
  baseline_28d: number;
  recent_daily_avg: number;
  baseline_daily_avg: number;
  z_score: number | null;
  ratio: number;
  recent_negative_ratio: number | null;
};

// SURGE 스코어 소스 — asOf가 null(오늘)이면 view, 그 외면 TVF.
function surgeSource(asOf: string | null): string {
  return asOf
    ? `\`wanted-data.wanted_ml_voc.voc_surge_score_at\`(DATE('${asOf}'))`
    : `\`wanted-data.wanted_ml_voc.voc_surge_score\``;
}

// 원자적 스냅샷 — 필터·정렬 없이 모든 카테고리 반환. StatusOverview와 WatchGrid를
// 이 결과에서 파생시키면 두 값이 항상 일관됨 (소스가 실시간으로 자라도).
export async function fetchAllSurges(
  category1?: string | null,
  asOf?: string | null,
  category2?: string | null,
  category3?: string | null,
): Promise<SurgeItem[]> {
  return query<SurgeItem>(
    `
    SELECT surge_level, category1, category2, category3,
           recent_7d, recent_7d_negative, baseline_28d,
           recent_daily_avg, baseline_daily_avg, z_score, ratio, recent_negative_ratio
    FROM ${surgeSource(asOf ?? null)}
    WHERE (@category1 IS NULL OR category1 = @category1)
      AND (@category2 IS NULL OR category2 = @category2)
      AND (@category3 IS NULL OR category3 = @category3)
    `,
    {
      category1: category1 ?? null,
      category2: category2 ?? null,
      category3: category3 ?? null,
      asOf: asOf ?? null,
    }
  );
}

// In-memory derivation — fetchAllSurges 스냅샷 위에서 level별 카운트 집계.
export function deriveStatusSummary(rows: SurgeItem[]): StatusSummaryRow[] {
  const acc: Record<SurgeLevel, StatusSummaryRow> = {
    SURGE:    { surge_level: 'SURGE',    categories: 0, tickets: 0, negative_tickets: 0 },
    WATCH:    { surge_level: 'WATCH',    categories: 0, tickets: 0, negative_tickets: 0 },
    STABLE:   { surge_level: 'STABLE',   categories: 0, tickets: 0, negative_tickets: 0 },
    IMPROVED: { surge_level: 'IMPROVED', categories: 0, tickets: 0, negative_tickets: 0 },
  };
  for (const r of rows) {
    const bucket = acc[r.surge_level];
    if (!bucket) continue;
    bucket.categories += 1;
    bucket.tickets += Number(r.recent_7d) || 0;
    bucket.negative_tickets += Number(r.recent_7d_negative) || 0;
  }
  return (['SURGE', 'WATCH', 'STABLE', 'IMPROVED'] as SurgeLevel[])
    .map(l => acc[l])
    .filter(r => r.categories > 0);
}

// In-memory grid selection — 같은 스냅샷에서 필터·정렬·top N 파생.
export function deriveGridSurges(rows: SurgeItem[], levels: SurgeLevel[]): SurgeItem[] {
  const priority: Record<SurgeLevel, number> = { SURGE: 0, WATCH: 1, STABLE: 2, IMPROVED: 3 };
  let filtered = rows;
  let limit = 40;
  if (levels.length === 1) {
    const one = levels[0];
    filtered = rows.filter(r => r.surge_level === one);
    if (one === 'STABLE') filtered = filtered.filter(r => Number(r.recent_7d) > 0);
    limit = 20;
    const sorted = [...filtered].sort((a, b) => {
      if (one === 'STABLE') return Number(b.recent_7d) - Number(a.recent_7d);
      if (one === 'IMPROVED') return Number(a.ratio) - Number(b.ratio);
      return Number(b.ratio) - Number(a.ratio);
    });
    return sorted.slice(0, limit);
  }
  if (levels.length > 1) {
    const set = new Set(levels);
    filtered = rows.filter(r => set.has(r.surge_level));
  }
  const sorted = [...filtered].sort((a, b) => {
    const p = priority[a.surge_level] - priority[b.surge_level];
    if (p !== 0) return p;
    return Number(b.ratio) - Number(a.ratio);
  });
  return sorted.slice(0, limit);
}

export async function fetchSurges(
  category1?: string | null,
  levels: SurgeLevel[] = [],
  asOf?: string | null
): Promise<SurgeItem[]> {
  // 다중 선택: levels 비어있으면 all, 1개면 각 레벨 자체 정렬, 2+이면 결합 정렬(SURGE→WATCH→STABLE→IMPROVED, ratio desc)
  const singleConfig: Record<SurgeLevel, { orderBy: string; limit: number; extra?: string }> = {
    SURGE:    { orderBy: `ratio DESC`, limit: 20 },
    WATCH:    { orderBy: `ratio DESC`, limit: 20 },
    STABLE:   { orderBy: `recent_7d DESC`, limit: 20, extra: `AND recent_7d > 0` },
    IMPROVED: { orderBy: `ratio ASC`, limit: 20 },
  };
  const combinedOrder =
    `CASE surge_level WHEN 'SURGE' THEN 0 WHEN 'WATCH' THEN 1 WHEN 'STABLE' THEN 2 ELSE 3 END, ratio DESC`;

  let levelFilter = 'TRUE';
  let orderBy = combinedOrder;
  let limit = 40;
  if (levels.length === 1) {
    const cfg = singleConfig[levels[0]];
    levelFilter = `surge_level = '${levels[0]}' ${cfg.extra ?? ''}`.trim();
    orderBy = cfg.orderBy;
    limit = cfg.limit;
  } else if (levels.length > 1) {
    const inList = levels.map(l => `'${l}'`).join(',');
    levelFilter = `surge_level IN (${inList})`;
    orderBy = combinedOrder;
    limit = 40;
  }

  return query<SurgeItem>(
    `
    SELECT surge_level, category1, category2, category3,
           recent_7d, recent_7d_negative, baseline_28d,
           recent_daily_avg, baseline_daily_avg, z_score, ratio, recent_negative_ratio
    FROM ${surgeSource(asOf ?? null)}
    WHERE ${levelFilter}
      AND (@category1 IS NULL OR category1 = @category1)
    ORDER BY ${orderBy}
    LIMIT ${limit}
    `,
    { category1: category1 ?? null }
  );
}

// ────────────────────────────────────────────────────────────────────
// Segment summary — 세그먼트별 최근 7일 티켓 합 (SegFilter pill용)
// ────────────────────────────────────────────────────────────────────

export type SegSummary = { all: number; user: number; company: number };

export async function fetchSegSummary(asOf?: string | null): Promise<SegSummary> {
  const rows = await query<{ category1: string; tickets: number }>(
    `
    SELECT category1, SUM(recent_7d) AS tickets
    FROM ${surgeSource(asOf ?? null)}
    GROUP BY category1
    `
  );
  const map = new Map(rows.map(r => [r.category1, Number(r.tickets) || 0]));
  const user = map.get('유저') ?? 0;
  const company = map.get('기업') ?? 0;
  const all = Array.from(map.values()).reduce((s, n) => s + n, 0);
  return { all, user, company };
}

// ────────────────────────────────────────────────────────────────────
// Status summary — surge_level별 카테고리 수 / recent_7d 티켓 합
// ────────────────────────────────────────────────────────────────────

export type StatusSummaryRow = {
  surge_level: 'SURGE' | 'WATCH' | 'IMPROVED' | 'STABLE';
  categories: number;
  tickets: number;
  negative_tickets: number;
};

export async function fetchStatusSummary(
  category1?: string | null,
  asOf?: string | null
): Promise<StatusSummaryRow[]> {
  return query<StatusSummaryRow>(
    `
    SELECT surge_level,
           COUNT(*) AS categories,
           SUM(recent_7d) AS tickets,
           SUM(recent_7d_negative) AS negative_tickets
    FROM ${surgeSource(asOf ?? null)}
    WHERE (@category1 IS NULL OR category1 = @category1)
    GROUP BY surge_level
    `,
    { category1: category1 ?? null }
  );
}

// ────────────────────────────────────────────────────────────────────
// New keywords (seg + asOf 필터)
// ────────────────────────────────────────────────────────────────────

export type NewKeywordRow = {
  keyword: string;
  recent_mentions: number;
  recent_negative: number;
  top_category3: string;
  top_category1: string;
  prior_mentions: number;
};

export async function fetchNewKeywords(
  category1?: string | null,
  asOf?: string | null,
  category3?: string | null,
): Promise<NewKeywordRow[]> {
  return query<NewKeywordRow>(
    `
    WITH ref AS (SELECT ${AS_OF_DATE} AS d),
    prior AS (
      SELECT keyword, SUM(mentions) AS prior_mentions
      FROM \`wanted-data.wanted_ml_voc.voc_keyword_trend\`, ref
      WHERE week_start < DATE_SUB(ref.d, INTERVAL 2 WEEK)
        AND week_start >= DATE_SUB(ref.d, INTERVAL 12 WEEK)
      GROUP BY keyword
    ),
    recent AS (
      SELECT keyword,
             SUM(mentions) AS recent_mentions,
             SUM(negative_mentions) AS recent_negative,
             ANY_VALUE(top_category3) AS top_category3,
             ANY_VALUE(top_category1) AS top_category1
      FROM \`wanted-data.wanted_ml_voc.voc_keyword_trend\`, ref
      WHERE week_start >= DATE_SUB(ref.d, INTERVAL 2 WEEK)
        AND week_start <= ref.d
      GROUP BY keyword
    )
    SELECT r.keyword, r.recent_mentions, r.recent_negative,
           r.top_category3, r.top_category1, COALESCE(p.prior_mentions, 0) AS prior_mentions
    FROM recent r
    LEFT JOIN prior p USING (keyword)
    WHERE COALESCE(p.prior_mentions, 0) < 2 AND r.recent_mentions >= 3
      AND (@category1 IS NULL OR r.top_category1 = @category1)
      AND (@category3 IS NULL OR r.top_category3 = @category3)
    ORDER BY r.recent_mentions DESC
    LIMIT 20
    `,
    {
      category1: category1 ?? null,
      category3: category3 ?? null,
      asOf: asOf ?? null,
    }
  );
}

// ────────────────────────────────────────────────────────────────────
// 드릴다운 3종
// ────────────────────────────────────────────────────────────────────

export type CategoryTrendPoint = {
  week: { value: string };
  tickets: number;
  negative_tickets: number;
};

export async function fetchCategoryTrend(f: {
  category1?: string | null;
  category2: string;
  category3?: string | null;
  asOf?: string | null;
}): Promise<CategoryTrendPoint[]> {
  return query<CategoryTrendPoint>(
    `
    WITH ref AS (SELECT ${AS_OF_DATE} AS d)
    SELECT DATE_TRUNC(date, WEEK(MONDAY)) AS week,
           SUM(tickets) AS tickets, SUM(negative_tickets) AS negative_tickets
    FROM \`wanted-data.wanted_ml_voc.voc_daily\`, ref
    WHERE date >= DATE_SUB(ref.d, INTERVAL 12 WEEK)
      AND date <= ref.d
      AND category2 = @category2
      AND (@category3 IS NULL OR category3 = @category3)
      AND (@category1 IS NULL OR category1 = @category1)
    GROUP BY week ORDER BY week
    `,
    {
      category1: f.category1 ?? null,
      category2: f.category2,
      category3: f.category3 ?? null,
      asOf: f.asOf ?? null,
    }
  );
}

export type CategoryKeyword = {
  keyword: string;
  mentions: number;
  negative_mentions: number;
};

export async function fetchCategoryKeywords(f: {
  category3: string;
  asOf?: string | null;
}): Promise<CategoryKeyword[]> {
  return query<CategoryKeyword>(
    `
    WITH ref AS (SELECT ${AS_OF_DATE} AS d)
    SELECT keyword, SUM(mentions) AS mentions, SUM(negative_mentions) AS negative_mentions
    FROM \`wanted-data.wanted_ml_voc.voc_keyword_trend\`, ref
    WHERE week_start >= DATE_SUB(ref.d, INTERVAL 12 WEEK)
      AND week_start <= ref.d
      AND top_category3 = @category3
    GROUP BY keyword
    ORDER BY mentions DESC
    LIMIT 15
    `,
    { category3: f.category3, asOf: f.asOf ?? null }
  );
}

export type CategoryTicket = {
  id: string;
  event_create_time: { value: string };
  category3: string;
  main_topic: string;
  title: string;
  overall_emotion: string;
  detail_preview: string;
};

export async function fetchCategoryTickets(f: {
  category1?: string | null;
  category2: string;
  category3?: string | null;
  asOf?: string | null;
  onlyNegative?: boolean;
  weekStart?: string | null; // 지정 시 [weekStart, weekStart+6] 7일 창만
}): Promise<CategoryTicket[]> {
  const negFilter = f.onlyNegative ? `AND overall_emotion = '부정'` : '';
  const dateRange = f.weekStart
    ? `AND DATE(event_create_time, 'Asia/Seoul') >= @weekStart
       AND DATE(event_create_time, 'Asia/Seoul') <= DATE_ADD(@weekStart, INTERVAL 6 DAY)`
    : `AND DATE(event_create_time, 'Asia/Seoul') >= DATE_SUB(ref.d, INTERVAL 84 DAY)
       AND DATE(event_create_time, 'Asia/Seoul') <= ref.d`;
  return query<CategoryTicket>(
    `
    WITH ref AS (SELECT ${AS_OF_DATE} AS d)
    SELECT id, event_create_time, category3, main_topic, title, overall_emotion,
           SUBSTR(detail, 1, 3000) AS detail_preview
    FROM \`wanted-data.wanted_ml.zendesk_voc_classified\`, ref
    WHERE category2 = @category2
      AND (@category3 IS NULL OR category3 = @category3)
      AND (@category1 IS NULL OR category1 = @category1)
      ${dateRange}
      ${negFilter}
    ORDER BY (overall_emotion = '부정') DESC, event_create_time DESC
    LIMIT 30
    `,
    {
      category1: f.category1 ?? null,
      category2: f.category2,
      category3: f.category3 ?? null,
      asOf: f.asOf ?? null,
      weekStart: f.weekStart ?? null,
    }
  );
}

// ────────────────────────────────────────────────────────────────────
// 부정 감정 delta — 최근 7일 부정률 vs 직전 28일 baseline 부정률 (pp)
// (카테고리 SURGE와 동일한 window 정의로 통일)
// ────────────────────────────────────────────────────────────────────

export type NegDeltaRow = {
  category1: string;
  category2: string;
  recent_tickets: number;
  recent_negative: number;
  baseline_tickets: number;
  baseline_negative: number;
  recent_pct: number | null;
  baseline_pct: number | null;
  delta_pp: number | null;
};

export async function fetchNegDelta(
  category1?: string | null,
  asOf?: string | null,
  category2?: string | null,
): Promise<NegDeltaRow[]> {
  return query<NegDeltaRow>(
    `
    WITH ref AS (SELECT ${AS_OF_DATE} AS d),
    recent AS (
      SELECT category1, category2,
             SUM(tickets) AS tickets, SUM(negative_tickets) AS neg
      FROM \`wanted-data.wanted_ml_voc.voc_daily\`, ref
      WHERE date >= DATE_SUB(ref.d, INTERVAL 6 DAY) AND date <= ref.d
        AND category2 != '(미분류)'
        AND (@category1 IS NULL OR category1 = @category1)
        AND (@category2 IS NULL OR category2 = @category2)
      GROUP BY category1, category2
    ),
    baseline AS (
      SELECT category1, category2,
             SUM(tickets) AS tickets, SUM(negative_tickets) AS neg
      FROM \`wanted-data.wanted_ml_voc.voc_daily\`, ref
      WHERE date >= DATE_SUB(ref.d, INTERVAL 34 DAY)
        AND date <= DATE_SUB(ref.d, INTERVAL 7 DAY)
        AND category2 != '(미분류)'
        AND (@category1 IS NULL OR category1 = @category1)
        AND (@category2 IS NULL OR category2 = @category2)
      GROUP BY category1, category2
    )
    SELECT
      COALESCE(r.category1, b.category1) AS category1,
      COALESCE(r.category2, b.category2) AS category2,
      COALESCE(r.tickets, 0) AS recent_tickets,
      COALESCE(r.neg, 0) AS recent_negative,
      COALESCE(b.tickets, 0) AS baseline_tickets,
      COALESCE(b.neg, 0) AS baseline_negative,
      ROUND(SAFE_DIVIDE(r.neg, r.tickets) * 100, 1) AS recent_pct,
      ROUND(SAFE_DIVIDE(b.neg, b.tickets) * 100, 1) AS baseline_pct,
      ROUND(
        (COALESCE(SAFE_DIVIDE(r.neg, r.tickets), 0)
         - COALESCE(SAFE_DIVIDE(b.neg, b.tickets), 0)) * 100,
        1
      ) AS delta_pp
    FROM recent r
    FULL OUTER JOIN baseline b USING (category1, category2)
    WHERE COALESCE(r.tickets, 0) >= 5 AND COALESCE(b.tickets, 0) >= 20
    ORDER BY ABS(
      COALESCE(SAFE_DIVIDE(r.neg, r.tickets), 0)
      - COALESCE(SAFE_DIVIDE(b.neg, b.tickets), 0)
    ) DESC NULLS LAST
    LIMIT 20
    `,
    {
      category1: category1 ?? null,
      category2: category2 ?? null,
      asOf: asOf ?? null,
    }
  );
}

// ────────────────────────────────────────────────────────────────────
// MTD summary
// ────────────────────────────────────────────────────────────────────

export type MtdSummary = {
  mtd: number;
  mtd_negative: number;
  prev_same_period: number;
  mom_pct: number | null;
};

export async function fetchMtdSummary(
  asOf?: string | null,
  category1?: string | null,
  category2?: string | null,
  category3?: string | null,
): Promise<MtdSummary | null> {
  const catFilter = `
    AND (@category1 IS NULL OR category1 = @category1)
    AND (@category2 IS NULL OR category2 = @category2)
    AND (@category3 IS NULL OR category3 = @category3)
  `;
  const rows = await query<MtdSummary>(
    `
    WITH ref AS (SELECT ${AS_OF_DATE} AS d),
    cur AS (
      SELECT SUM(tickets) AS t, SUM(negative_tickets) AS n
      FROM \`wanted-data.wanted_ml_voc.voc_daily\`, ref
      WHERE date >= DATE_TRUNC(ref.d, MONTH) AND date <= ref.d
        ${catFilter}
    ),
    prev AS (
      SELECT SUM(tickets) AS t FROM \`wanted-data.wanted_ml_voc.voc_daily\`, ref
      WHERE date >= DATE_TRUNC(DATE_SUB(ref.d, INTERVAL 1 MONTH), MONTH)
        AND date <= DATE_ADD(
              DATE_TRUNC(DATE_SUB(ref.d, INTERVAL 1 MONTH), MONTH),
              INTERVAL DATE_DIFF(ref.d, DATE_TRUNC(ref.d, MONTH), DAY) DAY
            )
        ${catFilter}
    )
    SELECT cur.t AS mtd, cur.n AS mtd_negative, prev.t AS prev_same_period,
           ROUND(SAFE_DIVIDE(cur.t - prev.t, prev.t) * 100, 1) AS mom_pct
    FROM cur, prev
    `,
    {
      asOf: asOf ?? null,
      category1: category1 ?? null,
      category2: category2 ?? null,
      category3: category3 ?? null,
    }
  );
  return rows[0] ?? null;
}
