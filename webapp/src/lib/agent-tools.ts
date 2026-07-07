// Tools that the VOC analyst agent can call.
// SQL restricted to SELECT on whitelist of tables.
// Schema uses OpenAI function-calling format (compatible with GPT-5 tool_use).

import { bq } from './bq';

const ALLOWED_TABLES = [
  /`wanted-data\.wanted_ml_voc\.voc_daily`/,
  /`wanted-data\.wanted_ml_voc\.voc_surge_score`/,
  /`wanted-data\.wanted_ml_voc\.voc_keyword_trend`/,
  /`wanted-data\.wanted_ml_voc\.voc_actions`/,
  /`wanted-data\.wanted_ml_voc\.voc_actions_summary`/,
  /`wanted-data\.wanted_ml\.zendesk_voc_classified`/,
];

export const TOOL_SCHEMA = [
  {
    type: 'function' as const,
    function: {
      name: 'run_bigquery',
      description:
        'BigQuery SELECT 쿼리를 실행하고 최대 100행을 반환합니다. ' +
        '허용 테이블: wanted-data.wanted_ml_voc.voc_daily, voc_surge_score, voc_keyword_trend, ' +
        'voc_actions, voc_actions_summary, wanted-data.wanted_ml.zendesk_voc_classified. ' +
        '반드시 KST 타임존과 파티션 필터를 사용하세요.',
      parameters: {
        type: 'object' as const,
        properties: {
          sql: {
            type: 'string' as const,
            description: 'BigQuery Standard SQL SELECT 문 (한 문장). 세미콜론 없음.',
          },
        },
        required: ['sql'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_ticket_detail',
      description: 'Zendesk 티켓 ID로 원본 티켓 상세를 조회합니다 (title, main_topic, detail).',
      parameters: {
        type: 'object' as const,
        properties: {
          ticket_id: { type: 'string' as const, description: 'Zendesk 티켓 ID' },
        },
        required: ['ticket_id'],
        additionalProperties: false,
      },
    },
  },
];

function sqlIsSafe(sql: string): { ok: boolean; reason?: string } {
  const trimmed = sql.trim().replace(/;$/, '').trim();
  if (!/^(select|with)\b/i.test(trimmed)) {
    return { ok: false, reason: 'SELECT 또는 WITH로 시작해야 합니다.' };
  }
  if (/;/.test(trimmed)) {
    return { ok: false, reason: '단일 문장만 허용됩니다 (세미콜론 금지).' };
  }
  if (/\b(insert|update|delete|drop|alter|create|merge|truncate)\b/i.test(trimmed)) {
    return { ok: false, reason: '변경 쿼리는 허용되지 않습니다.' };
  }
  if (!ALLOWED_TABLES.some(re => re.test(sql))) {
    return { ok: false, reason: '허용되지 않은 테이블 참조.' };
  }
  return { ok: true };
}

export async function runBigQuery(sql: string): Promise<
  | { ok: true; rows: unknown[]; row_count: number; truncated: boolean }
  | { ok: false; error: string }
> {
  const safety = sqlIsSafe(sql);
  if (!safety.ok) return { ok: false, error: safety.reason! };
  try {
    const [job] = await bq().createQueryJob({
      query: sql,
      location: 'asia-northeast3',
      maximumBytesBilled: String(3 * 1024 ** 3),
      useLegacySql: false,
    });
    const [rows] = await job.getQueryResults({ maxResults: 100 });
    return {
      ok: true,
      rows: rows.slice(0, 100),
      row_count: rows.length,
      truncated: rows.length >= 100,
    };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getTicketDetail(ticketId: string): Promise<
  | { ok: true; ticket: Record<string, unknown> }
  | { ok: false; error: string }
> {
  if (!/^\d+$/.test(ticketId)) {
    return { ok: false, error: 'ticket_id는 숫자 문자열이어야 합니다.' };
  }
  try {
    const [rows] = await bq().query({
      query: `
        SELECT id, event_create_time, category1, category2, category3,
               overall_emotion, main_topic, title, SUBSTR(detail, 1, 800) AS detail_preview, keywords
        FROM \`wanted-data.wanted_ml.zendesk_voc_classified\`
        WHERE id = @id
        LIMIT 1
      `,
      params: { id: ticketId },
      location: 'asia-northeast3',
      maximumBytesBilled: String(3 * 1024 ** 3),
    });
    if (!rows.length) return { ok: false, error: 'not found' };
    return { ok: true, ticket: rows[0] };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function runTool(name: string, input: Record<string, unknown>) {
  if (name === 'run_bigquery' && typeof input.sql === 'string') {
    return await runBigQuery(input.sql);
  }
  if (name === 'get_ticket_detail' && typeof input.ticket_id === 'string') {
    return await getTicketDetail(input.ticket_id);
  }
  return { ok: false, error: `unknown tool: ${name}` };
}
