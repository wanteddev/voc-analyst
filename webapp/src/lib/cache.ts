import { createHash } from 'crypto';

// Redis 캐시 — REDIS_URL 없거나 연결 실패 시 조용히 no-op (로컬 개발·장애 안전).
// BQ 일일 quota 방어가 목적: 같은 SQL+params는 25시간 캐시.
// asOf(default=어제)가 key에 포함되므로 날짜가 바뀌면 키가 자연 교체됨.

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: string, ttl: number): Promise<unknown>;
  on(event: string, cb: (...args: unknown[]) => void): unknown;
  // Streams (이벤트 트래킹용) — events.ts에서 사용
  xadd(...args: (string | number)[]): Promise<string | null>;
  xrevrange(
    key: string, end: string, start: string, countToken: string, count: number
  ): Promise<Array<[string, string[]]>>;
  xlen(key: string): Promise<number>;
};

let redis: RedisLike | null = null;
let initTried = false;
let healthy = false;

async function getRedis(): Promise<RedisLike | null> {
  if (initTried) return healthy ? redis : null;
  initTried = true;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const { default: Redis } = await import('ioredis');
    const client = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: false,
      retryStrategy: (times: number) => (times > 3 ? null : Math.min(times * 200, 1000)),
    });
    client.on('error', () => {
      // 연결 장애 시 이후 요청은 BQ 직행. 스팸 로그 방지 위해 healthy만 내림.
      healthy = false;
    });
    client.on('ready', () => {
      healthy = true;
    });
    redis = client as unknown as RedisLike;
    healthy = true; // optimistic — 첫 get이 실패하면 error 이벤트로 내려감
    return redis;
  } catch (e) {
    console.error('[cache] redis init failed:', e);
    return null;
  }
}

// 이벤트 트래킹(events.ts)이 XADD/XREVRANGE에 쓰는 raw 클라이언트. 캐시와 같은 연결 재사용.
// REDIS 없거나 비정상이면 null → events.ts가 조용히 no-op.
export async function redisClient(): Promise<RedisLike | null> {
  const r = await getRedis();
  if (!r || !healthy) return null;
  return r;
}

export function cacheKey(sql: string, params?: Record<string, unknown>): string {
  const h = createHash('sha256')
    .update(sql)
    .update(JSON.stringify(params ?? {}))
    .digest('hex')
    .slice(0, 32);
  return `voc:q:${h}`;
}

const TTL_SECONDS = 25 * 3600; // 25h — 하루 1회 데이터 적재 주기보다 약간 길게

export async function cacheGet<T>(key: string): Promise<T | null> {
  const r = await getRedis();
  if (!r || !healthy) return null;
  try {
    const raw = await r.get(key);
    if (raw == null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  const r = await getRedis();
  if (!r || !healthy) return;
  try {
    await r.set(key, JSON.stringify(value), 'EX', TTL_SECONDS);
  } catch {
    // 캐시 실패는 무시 — 다음 요청이 다시 BQ로 감
  }
}
