import { BigQuery } from '@google-cloud/bigquery';
import { cacheKey, cacheGet, cacheSet } from './cache';

let client: BigQuery | null = null;

function loadCredentials(): Record<string, unknown> | undefined {
  const raw = process.env.GCP_SA_KEY;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error('[bq] failed to parse GCP_SA_KEY:', e);
    return undefined;
  }
}

export function bq(): BigQuery {
  if (!client) {
    client = new BigQuery({
      projectId: process.env.BQ_PROJECT || 'wanted-data',
      location: 'asia-northeast3',
      credentials: loadCredentials(),
    });
  }
  return client;
}

// Named parameter query. Pass @paramName in SQL and { paramName: value } in params.
// BQ SDK requires `types` for null values; we derive per-param type: value !== null → auto,
// value === null → STRING (모든 nullable filter가 category 문자열이라 STRING 기본).
//
// Redis cache-aside (TTL 25h): 같은 SQL+params는 하루 한 번만 BQ 실행.
// 소스 데이터가 일 1회(전일자) 적재라 신선도 손실 없음. BQ 일일 quota 방어 목적.
// asOf param이 key에 포함되므로 날짜 전환 시 키 자연 교체.
// Single-flight: 같은 캐시 키의 쿼리가 동시에 실행되면(예: 한 요청에서 fetchAllSurges가
// KPI용·WeeklySummary용으로 두 번 호출) BQ를 한 번만 실행하고 결과를 공유한다.
// → 실시간 적재 중인 소스라도 두 소비자가 동일 스냅샷을 받아 카운트 일관성 유지 + 중복 BQ 방지.
const inflight = new Map<string, Promise<unknown[]>>();

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: Record<string, unknown>,
  maxGB = 5
): Promise<T[]> {
  const key = cacheKey(sql, params);
  const cached = await cacheGet<T[]>(key);
  if (cached !== null) return cached;

  const existing = inflight.get(key);
  if (existing) return existing as Promise<T[]>;

  const run = (async () => {
    let types: Record<string, string> | undefined;
    if (params) {
      const nullEntries = Object.entries(params).filter(([, v]) => v === null);
      if (nullEntries.length > 0) {
        types = Object.fromEntries(nullEntries.map(([k]) => [k, 'STRING']));
      }
    }
    const [rows] = await bq().query({
      query: sql,
      params,
      types,
      location: 'asia-northeast3',
      maximumBytesBilled: String(maxGB * 1024 ** 3),
      useLegacySql: false,
    });
    await cacheSet(key, rows);
    return rows as T[];
  })();

  inflight.set(key, run as Promise<unknown[]>);
  try {
    return await run;
  } finally {
    inflight.delete(key);
  }
}
