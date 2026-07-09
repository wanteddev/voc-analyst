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

export type { LevelKey, SurgeLevel, EmotionKey } from './level';
export { LEVEL_KEY_TO_SURGE, SURGE_TO_LEVEL_KEY, EMOTION_TO_KO } from './level';
import type { SurgeLevel, EmotionKey } from './level';
import { EMOTION_TO_KO } from './level';

// EmotionKey → BQ emotion 값 ('부정' 등). 'all'이면 null (필터 없음).
function emoParam(emotion?: EmotionKey | null): string | null {
  if (!emotion || emotion === 'all') return null;
  return EMOTION_TO_KO[emotion];
}

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
// emo(한글 감정값)는 TVF 경로에서만 지원 — 페이지가 항상 asOf(어제 default)를 넘기므로 실질 전체 커버.
function surgeSource(asOf: string | null, emo: string | null = null): string {
  if (!asOf) return `\`wanted-data.wanted_ml_voc.voc_surge_score\``;
  const emoArg = emo ? `'${emo.replace(/'/g, '')}'` : 'NULL';
  return `\`wanted-data.wanted_ml_voc.voc_surge_score_at\`(DATE('${asOf}'), ${emoArg})`;
}

// 원자적 스냅샷 — 필터·정렬 없이 모든 카테고리 반환. StatusOverview와 WatchGrid를
// 이 결과에서 파생시키면 두 값이 항상 일관됨 (소스가 실시간으로 자라도).
export async function fetchAllSurges(
  category1?: string | null,
  asOf?: string | null,
  category2?: string | null,
  category3?: string | null,
  emotion?: EmotionKey | null,
): Promise<SurgeItem[]> {
  return query<SurgeItem>(
    `
    SELECT surge_level, category1, category2, category3,
           recent_7d, recent_7d_negative, baseline_28d,
           recent_daily_avg, baseline_daily_avg, z_score, ratio, recent_negative_ratio
    FROM ${surgeSource(asOf ?? null, emoParam(emotion))}
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

export async function fetchSegSummary(
  asOf?: string | null,
  emotion?: EmotionKey | null,
): Promise<SegSummary> {
  const rows = await query<{ category1: string; tickets: number }>(
    `
    SELECT category1, SUM(recent_7d) AS tickets
    FROM ${surgeSource(asOf ?? null, emoParam(emotion))}
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

// 키워드 집계는 현재 드릴다운 카테고리(cat1/cat2/cat3)로 스코프해 원천 테이블에서 직접
// 산출. voc_keyword_trend는 키워드를 전 카테고리 기준으로 집계하고 top_category3(대표값)로만
// 버킷팅하므로 카테고리별 정확 카운트가 불가능 — 그래서 원천 UNNEST로 대체(티켓 쿼리와 동일 스코프).
// event_create_time 파티션 범위를 asOf 기준으로 좁혀 스캔 비용 방어.
export async function fetchCategoryKeywords(f: {
  category1?: string | null;
  category2: string;
  category3?: string | null;
  asOf?: string | null;
  weekStart?: string | null; // 지정 시 해당 주(월요일 시작) 7일만
}): Promise<CategoryKeyword[]> {
  const dateWindow = f.weekStart
    ? `AND DATE(event_create_time, 'Asia/Seoul') >= SAFE_CAST(@weekStart AS DATE)
       AND DATE(event_create_time, 'Asia/Seoul') <= DATE_ADD(SAFE_CAST(@weekStart AS DATE), INTERVAL 6 DAY)`
    : `AND DATE(event_create_time, 'Asia/Seoul') >= DATE_SUB(${AS_OF_DATE}, INTERVAL 84 DAY)
       AND DATE(event_create_time, 'Asia/Seoul') <= ${AS_OF_DATE}`;
  return query<CategoryKeyword>(
    `
    SELECT TRIM(kw) AS keyword,
           COUNT(*) AS mentions,
           COUNTIF(overall_emotion = '부정') AS negative_mentions
    FROM \`wanted-data.wanted_ml.zendesk_voc_classified\`,
         UNNEST(SPLIT(keywords, ',')) AS kw
    WHERE event_create_time >= TIMESTAMP(DATE_SUB(${AS_OF_DATE}, INTERVAL 100 DAY), 'Asia/Seoul')
      AND event_create_time <  TIMESTAMP(DATE_ADD(${AS_OF_DATE}, INTERVAL 1 DAY), 'Asia/Seoul')
      AND keywords IS NOT NULL AND keywords != ''
      AND LENGTH(TRIM(kw)) >= 2
      AND category2 = @category2
      AND (@category1 IS NULL OR category1 = @category1)
      AND (@category3 IS NULL OR category3 = @category3)
      ${dateWindow}
    GROUP BY keyword
    ORDER BY mentions DESC
    LIMIT 15
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

// 특정 키워드의 주간 언급 추이 — 키워드 선택 시 차트가 이 데이터로 전환.
export type KeywordTrendPoint = {
  week: { value: string };
  mentions: number;
  negative_mentions: number;
};

// 선택 키워드 주간 언급 추이 — 키워드 칩과 동일하게 카테고리 스코프로 원천 집계.
export async function fetchKeywordTrend(f: {
  category1?: string | null;
  category2: string;
  category3?: string | null;
  keyword: string;
  asOf?: string | null;
}): Promise<KeywordTrendPoint[]> {
  return query<KeywordTrendPoint>(
    `
    SELECT DATE_TRUNC(DATE(event_create_time, 'Asia/Seoul'), WEEK(MONDAY)) AS week,
           COUNT(*) AS mentions,
           COUNTIF(overall_emotion = '부정') AS negative_mentions
    FROM \`wanted-data.wanted_ml.zendesk_voc_classified\`,
         UNNEST(SPLIT(keywords, ',')) AS kw
    WHERE event_create_time >= TIMESTAMP(DATE_SUB(${AS_OF_DATE}, INTERVAL 100 DAY), 'Asia/Seoul')
      AND event_create_time <  TIMESTAMP(DATE_ADD(${AS_OF_DATE}, INTERVAL 1 DAY), 'Asia/Seoul')
      AND DATE(event_create_time, 'Asia/Seoul') >= DATE_SUB(${AS_OF_DATE}, INTERVAL 84 DAY)
      AND DATE(event_create_time, 'Asia/Seoul') <= ${AS_OF_DATE}
      AND keywords IS NOT NULL AND keywords != ''
      AND TRIM(kw) = @keyword
      AND category2 = @category2
      AND (@category1 IS NULL OR category1 = @category1)
      AND (@category3 IS NULL OR category3 = @category3)
    GROUP BY week ORDER BY week
    `,
    {
      category1: f.category1 ?? null,
      category2: f.category2,
      category3: f.category3 ?? null,
      keyword: f.keyword,
      asOf: f.asOf ?? null,
    }
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
  keyword?: string | null;   // 지정 시 제목/주제/원문에 키워드 포함 티켓만
}): Promise<CategoryTicket[]> {
  const negFilter = f.onlyNegative ? `AND overall_emotion = '부정'` : '';
  const dateRange = f.weekStart
    ? `AND DATE(event_create_time, 'Asia/Seoul') >= @weekStart
       AND DATE(event_create_time, 'Asia/Seoul') <= DATE_ADD(SAFE_CAST(@weekStart AS DATE), INTERVAL 6 DAY)`
    : `AND DATE(event_create_time, 'Asia/Seoul') >= DATE_SUB(ref.d, INTERVAL 84 DAY)
       AND DATE(event_create_time, 'Asia/Seoul') <= ref.d`;
  // 키워드 매칭은 트렌드 집계와 동일 소스인 keywords 컬럼(콤마 구분) 정확 매칭을
  // 우선하고, 본문 텍스트 검색을 OR로 더해 recall을 넓힘. keywords 컬럼을 빼면
  // ML이 추출한 정규화 키워드(예: "채용 공고")가 본문에 그대로 없을 때 0건이 됨.
  const keywordFilter = f.keyword
    ? `AND (
         EXISTS (SELECT 1 FROM UNNEST(SPLIT(keywords, ',')) kw WHERE TRIM(kw) = @keyword)
         OR CONTAINS_SUBSTR(title, @keyword)
         OR CONTAINS_SUBSTR(main_topic, @keyword)
         OR CONTAINS_SUBSTR(detail, @keyword)
       )`
    : '';
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
      ${keywordFilter}
    ORDER BY (overall_emotion = '부정') DESC, event_create_time DESC
    LIMIT 30
    `,
    {
      category1: f.category1 ?? null,
      category2: f.category2,
      category3: f.category3 ?? null,
      asOf: f.asOf ?? null,
      weekStart: f.weekStart ?? null,
      keyword: f.keyword ?? null,
    }
  );
}

// (부정 감정 delta 섹션은 감정 필터 도입으로 제거됨 — git history 참고)

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
  emotion?: EmotionKey | null,
): Promise<MtdSummary | null> {
  const catFilter = `
    AND (@category1 IS NULL OR category1 = @category1)
    AND (@category2 IS NULL OR category2 = @category2)
    AND (@category3 IS NULL OR category3 = @category3)
    AND (@emo IS NULL OR emotion = @emo)
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
      emo: emoParam(emotion),
    }
  );
  return rows[0] ?? null;
}
