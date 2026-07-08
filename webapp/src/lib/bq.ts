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
export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: Record<string, unknown>,
  maxGB = 5
): Promise<T[]> {
  const key = cacheKey(sql, params);
  const cached = await cacheGet<T[]>(key);
  if (cached !== null) return cached;

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
}
