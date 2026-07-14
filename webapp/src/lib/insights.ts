// 주간 요약 인사이트 (하이브리드) — 규칙 기반 지표 + LLM 서술 한 줄.
// 범위: 항상 서비스 전체 (현재 필터와 무관). asOf 기준 whole-service 스냅샷에서 파생.
//
// 비용 방어:
// - 규칙 기반 지표는 순수 in-memory 파생 (추가 BQ 없음 — whole-service 스냅샷은 Redis 캐시).
// - LLM 서술은 asOf당 1회만 호출되도록 Redis(25h) + in-process 메모로 이중 캐시.
//   OPENAI_API_KEY 없거나 실패 시 조용히 null → 화면은 지표만 노출 (graceful degrade).

import {
  fetchAllSurges,
  fetchNewKeywords,
  fetchMtdSummary,
  type SurgeItem,
  type NewKeywordRow,
  type MtdSummary,
} from './queries';
import { cacheGet, cacheSet } from './cache';
import type { ProductFilters } from './product-url';
import { createHash } from 'crypto';

const NARRATIVE_VERSION = 'v1';

export type InsightSeverity = 'surge' | 'watch' | 'good' | 'neutral';

export type InsightItem = {
  icon: string;
  severity: InsightSeverity;
  text: string;
  // 클릭 시 이동할 필터 patch (없으면 정보성 칩). 컴포넌트가 buildProductHref로 조합.
  link?: Partial<ProductFilters>;
};

export type WeeklyInsights = {
  items: InsightItem[];
  narrative: string | null;
};

// 카테고리 표시 라벨 — "대분류 · 중분류/소분류" (미분류 축약)
function catLabel(s: { category1: string; category2: string; category3: string }): string {
  const c1 = s.category1 && s.category1 !== '(미분류)' ? s.category1 : null;
  const c2 = s.category2 && s.category2 !== '(미분류)' ? s.category2 : null;
  const c3 = s.category3 && s.category3 !== '(미분류)' ? s.category3 : null;
  const tail = [c2, c3].filter(Boolean).join('/') || '(미분류)';
  return c1 ? `${c1} · ${tail}` : tail;
}

function segForCategory1(category1: string): ProductFilters['seg'] {
  if (category1 === '유저') return 'user';
  if (category1 === '기업') return 'company';
  return 'all';
}

// 규칙 기반 파생 — 순수 함수. whole-service 스냅샷에서 4종 인사이트 추출.
export function deriveInsights(
  surges: SurgeItem[],
  keywords: NewKeywordRow[],
  mtd: MtdSummary | null,
): InsightItem[] {
  const items: InsightItem[] = [];

  // 1) 급증 카테고리 — SURGE 개수 + 배수 최대
  const surging = surges.filter(s => s.surge_level === 'SURGE');
  if (surging.length > 0) {
    const top = [...surging].sort((a, b) => Number(b.ratio) - Number(a.ratio))[0];
    const others = surging.length - 1;
    items.push({
      icon: '🔴',
      severity: 'surge',
      text:
        `급증 ${surging.length}개 카테고리` +
        ` — 가장 큰 건 ${catLabel(top)} (평시 대비 ${Number(top.ratio).toFixed(1)}배` +
        `, 최근 7일 ${Number(top.recent_7d)}건)` +
        (others > 0 ? ` 외 ${others}개` : ''),
      link: {
        seg: segForCategory1(top.category1),
        levels: ['SURGE'],
        category2: top.category2 !== '(미분류)' ? top.category2 : null,
        category3: top.category3 !== '(미분류)' ? top.category3 : null,
      },
    });
  }

  // 2) 부정 감정 — 유의미한 볼륨(최근 7일 ≥5건) 중 부정 비중 최대
  const negCandidates = surges
    .filter(s => Number(s.recent_7d) >= 5 && s.recent_negative_ratio != null)
    .sort((a, b) => Number(b.recent_negative_ratio) - Number(a.recent_negative_ratio));
  const topNeg = negCandidates[0];
  if (topNeg && Number(topNeg.recent_negative_ratio) >= 0.3) {
    items.push({
      icon: '⚠️',
      severity: 'watch',
      text:
        `부정 감정이 두드러진 곳: ${catLabel(topNeg)}` +
        ` (부정 ${(Number(topNeg.recent_negative_ratio) * 100).toFixed(0)}%` +
        `, 최근 7일 ${Number(topNeg.recent_7d)}건)`,
      link: {
        seg: segForCategory1(topNeg.category1),
        emotion: 'negative',
        category2: topNeg.category2 !== '(미분류)' ? topNeg.category2 : null,
        category3: topNeg.category3 !== '(미분류)' ? topNeg.category3 : null,
      },
    });
  }

  // 3) 신규 키워드 — 언급 최다 (keywords는 recent_mentions desc 정렬 상태)
  const kw = keywords[0];
  if (kw) {
    const c3 = kw.top_category3 && kw.top_category3 !== '(미분류)' ? kw.top_category3 : null;
    items.push({
      icon: '🆕',
      severity: 'neutral',
      text:
        `신규 키워드 "${kw.keyword}" 급부상 (${Number(kw.recent_mentions)}회 언급` +
        (c3 ? ` · ${c3}` : '') +
        (Number(kw.recent_negative) > 0 ? ` · 부정 ${Number(kw.recent_negative)}` : '') +
        `)`,
      link: c3
        ? {
            seg: segForCategory1(kw.top_category1),
            category3: c3,
          }
        : undefined,
    });
  }

  // 4) 전월 대비 전체 문의량
  if (mtd && mtd.mom_pct != null && mtd.prev_same_period) {
    const up = Number(mtd.mom_pct) > 0;
    items.push({
      icon: up ? '📈' : '📉',
      severity: up ? 'watch' : 'good',
      text:
        `전체 문의량 전월 동기간 대비 ${up ? '+' : ''}${Number(mtd.mom_pct)}%` +
        ` (월누적 ${Number(mtd.mtd || 0).toLocaleString()}건)`,
    });
  }

  return items;
}

// LLM 서술 — asOf당 1회. Redis(25h) + in-process 메모 이중 캐시.
const narrativeMemo = new Map<string, string | null>();

async function narrate(items: InsightItem[], asOf: string): Promise<string | null> {
  if (items.length === 0) return null;
  // 지표(facts)가 하루 안에 드리프트(경계값 카테고리 SURGE↔WATCH 등)해도 서술이
  // 옛 내용으로 남지 않도록, 캐시 키에 facts 해시를 포함 → facts 바뀌면 서술 재생성.
  const facts = items.map(i => `- ${i.text}`).join('\n');
  const factsHash = createHash('sha256').update(facts).digest('hex').slice(0, 12);
  const key = `voc:insight:narrative:${NARRATIVE_VERSION}:${asOf}:${factsHash}`;

  if (narrativeMemo.has(key)) return narrativeMemo.get(key) ?? null;
  const cached = await cacheGet<string>(key);
  if (cached !== null) {
    narrativeMemo.set(key, cached);
    return cached;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey });
    const model = process.env.OPENAI_MODEL || 'gpt-5-mini';

    const resp = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content:
            '당신은 원티드 VOC 대시보드의 요약 작성자입니다. ' +
            '아래 "사실"만 사용해 프로덕트팀을 위한 이번 주 상황을 1~2문장 한국어 평문으로 요약하세요. ' +
            '규칙: (1) 사실에 없는 수치·카테고리를 지어내지 말 것. (2) 마크다운·불릿·이모지 금지, 자연스러운 문장. ' +
            '(3) 가장 주목할 신호를 먼저 언급하고, 프로덕트 관점의 함의를 한 마디 덧붙일 것. (4) 80자 내외로 간결하게.',
        },
        { role: 'user', content: `사실:\n${facts}` },
      ],
    });
    const text = (resp.choices[0]?.message?.content ?? '').trim() || null;
    narrativeMemo.set(key, text);
    if (text) await cacheSet(key, text);
    return text;
  } catch (e) {
    console.error('[insights] narrate failed:', e);
    return null;
  }
}

// 진입점 — whole-service 스냅샷 fetch → 규칙 파생 → 서술(캐시) → 번들.
export async function fetchWeeklyInsights(asOf: string): Promise<WeeklyInsights> {
  const [surges, keywords, mtd] = await Promise.all([
    fetchAllSurges(null, asOf, null, null, 'all'),
    fetchNewKeywords(null, asOf, null),
    fetchMtdSummary(asOf, null, null, null, 'all'),
  ]);
  const items = deriveInsights(surges, keywords, mtd);
  const narrative = await narrate(items, asOf);
  return { items, narrative };
}
