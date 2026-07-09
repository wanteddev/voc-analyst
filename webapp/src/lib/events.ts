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

export async function streamLength(): Promise<number> {
  try {
    const r = await redisClient();
    if (!r) return 0;
    return await r.xlen(STREAM);
  } catch {
    return 0;
  }
}
