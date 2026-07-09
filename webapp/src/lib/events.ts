// 사용 트래킹 이벤트 — Redis Streams(voc:events)에 append.
// 식별은 IP 익명(게이트웨이가 사용자 신원을 전달하지 않음, Phase 0 확인).
// 캐시(cache.ts)와 같은 Redis 연결 재사용. REDIS 없으면 조용히 no-op(사용자 영향 0).

import { redisClient } from './cache';

const STREAM = 'voc:events';
const MAXLEN = 200_000; // 보존량 상한 = 사실상 보존정책 (approx trim)

export type EventFields = Record<string, string | number | undefined | null>;

// x-forwarded-for(첫 IP) → x-real-ip 순으로 클라이언트 IP 추출.
export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }
  return headers.get('x-real-ip') || 'unknown';
}

export async function logEvent(fields: EventFields): Promise<void> {
  try {
    const r = await redisClient();
    if (!r) return;
    const flat: (string | number)[] = [];
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || v === null || v === '') continue;
      flat.push(k, typeof v === 'number' ? v : String(v));
    }
    if (flat.length === 0) return;
    // XADD voc:events MAXLEN ~ 200000 * k v k v ...
    await r.xadd(STREAM, 'MAXLEN', '~', MAXLEN, '*', ...flat);
  } catch {
    // 트래킹 실패는 무시 — 사용자 경험에 영향 주지 않음
  }
}

export type StreamEvent = { id: string; fields: Record<string, string> };

// 최근 이벤트 N건 (신순). /api/usage 리포팅용.
export async function recentEvents(count = 500): Promise<StreamEvent[]> {
  try {
    const r = await redisClient();
    if (!r) return [];
    const res = await r.xrevrange(STREAM, '+', '-', 'COUNT', count);
    return (res || []).map(([id, arr]) => {
      const fields: Record<string, string> = {};
      for (let i = 0; i + 1 < arr.length; i += 2) fields[arr[i]] = arr[i + 1];
      return { id, fields };
    });
  } catch {
    return [];
  }
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

export type UsageSummary = {
  sampled: number;
  by_type: Record<string, number>;
  unique_ips: number;
  top_filters: Array<{ key: string; count: number }>;
  top_drilldowns: Array<{ key: string; count: number }>;
  recent_agent_queries: Array<{
    ts: string; ip: string; prompt: string; sql: string; tokens: string; steps: string;
  }>;
};

// 이벤트 목록 → 사용 현황 집계. /api/usage와 /admin 페이지가 공용.
export function aggregateUsage(events: StreamEvent[]): UsageSummary {
  const by_type: Record<string, number> = {};
  const ips = new Set<string>();
  const filterCount: Record<string, number> = {};
  const drilldownCount: Record<string, number> = {};
  const recent_agent_queries: UsageSummary['recent_agent_queries'] = [];

  for (const { fields: f } of events) {
    if (f.type) by_type[f.type] = (by_type[f.type] ?? 0) + 1;
    if (f.ip) ips.add(f.ip);
    if (f.type === 'page_view') {
      const key = f.filters ? safeDecode(f.filters) : '(필터 없음)';
      filterCount[key] = (filterCount[key] ?? 0) + 1;
    }
    if (f.type === 'drilldown_open' && f.detail) {
      drilldownCount[f.detail] = (drilldownCount[f.detail] ?? 0) + 1;
    }
    if (f.type === 'agent_query') {
      recent_agent_queries.push({
        ts: f.ts ?? '', ip: f.ip ?? '', prompt: f.prompt ?? '',
        sql: f.sql ?? '', tokens: f.tokens ?? '', steps: f.steps ?? '',
      });
    }
  }

  const topN = (m: Record<string, number>, n: number) =>
    Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([key, count]) => ({ key, count }));

  return {
    sampled: events.length,
    by_type,
    unique_ips: ips.size,
    top_filters: topN(filterCount, 20),
    top_drilldowns: topN(drilldownCount, 20),
    recent_agent_queries: recent_agent_queries.slice(0, 30),
  };
}

export async function streamLength(): Promise<number> {
  try {
    const r = await redisClient();
    if (!r) return 0;
    return await r.xlen(STREAM);
  } catch {
    return 0;
  }
}
