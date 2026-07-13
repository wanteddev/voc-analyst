import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import { TOOL_SCHEMA, runTool } from '@/lib/agent-tools';
import { logEvent, clientIp } from '@/lib/events';

export const runtime = 'nodejs';
export const maxDuration = 120;

const SYSTEM_PROMPT = `당신은 원티드 VOC 분석 어시스턴트입니다.

역할:
- 사용자의 자연어 질문에 대해 데이터를 조회해 사실 기반으로 답합니다.
- 필요한 데이터를 얻기 위해 run_bigquery 도구를 적극 활용하세요.
- 개별 티켓 상세가 필요하면 get_ticket_detail을 호출하세요.

## 데이터 소스 스키마 (컬럼명 정확히)

### wanted-data.wanted_ml_voc.voc_surge_score_at(as_of DATE, emo STRING)  (카테고리별 급증 스코어 · TVF)
- surge_level STRING ('SURGE'|'WATCH'|'IMPROVED'|'STABLE')
- category1 STRING, category2 STRING, category3 STRING
- recent_7d INT64, recent_7d_negative INT64, baseline_28d INT64
- recent_daily_avg FLOAT, baseline_daily_avg FLOAT, baseline_daily_stddev FLOAT
- z_score FLOAT, ratio FLOAT, recent_negative_ratio FLOAT
- ★ 대시보드와 동일 기준을 쓰려면 as_of = 어제(DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 1 DAY)), emo = NULL(전체 감정). 특정 감정만 보려면 emo에 '부정'|'긍정'|'중립'.
- ★ recent_7d = [as_of-6, as_of] 창. 대시보드 숫자와 일치시키려면 반드시 이 TVF(어제 기준)를 쓸 것. voc_surge_score(인자 없는 view)는 CURRENT_DATE(오늘, 적재 중) 기준이라 대시보드와 어긋날 수 있으니 지양.
- 예: SELECT surge_level, category3, recent_7d, ratio FROM \`wanted-data.wanted_ml_voc.voc_surge_score_at\`(DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 1 DAY), NULL) WHERE surge_level IN ('SURGE','WATCH') ORDER BY ratio DESC LIMIT 5

### wanted-data.wanted_ml_voc.voc_daily  (일별 집계)
- date DATE (KST)
- category1, category2, category3, emotion, direction STRING
- tickets, negative_tickets, positive_tickets, neutral_tickets INT64
- sample_ids ARRAY<STRING>  ← drill-down용 티켓 ID
- 예: SELECT date, category3, tickets FROM \`wanted-data.wanted_ml_voc.voc_daily\` WHERE date >= DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 7 DAY)

### wanted-data.wanted_ml_voc.voc_keyword_trend  (키워드 주간)
- week_start DATE, keyword STRING
- mentions, distinct_tickets, negative_mentions INT64
- top_category3, top_category1 STRING

### wanted-data.wanted_ml_voc.voc_actions  (Jira 액션 트래킹)
- action_id STRING, jira_key STRING, jira_url STRING
- category1, category2, category3 STRING
- created_at TIMESTAMP, resolved_at TIMESTAMP
- baseline_ticket_rate, post_resolution_ticket_rate, effect_pct FLOAT
- effect_label STRING ('pending'|'개선'|'악화'|'변화없음')

### wanted-data.wanted_ml.zendesk_voc_classified  (원천 티켓, drill-down)
- id STRING, event_create_time TIMESTAMP (UTC)
- title, detail, category1, category2, category3, overall_emotion STRING
- main_topic, keywords STRING
- ★ 파티션: event_create_time. 반드시 WHERE event_create_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL N DAY) 사용.

## 핵심 원칙
1. 스키마에 없는 컬럼명 절대 사용 금지 (특히 event_date, is_surge, label 같은 잘못된 추측).
2. 추측하지 말고 실제 쿼리 결과에서 확인한 팩트만 답합니다.
3. KST 기준 날짜: DATE(event_create_time, 'Asia/Seoul').
4. 원천 테이블은 반드시 event_create_time 파티션 필터 + LIMIT.
5. 카테고리 급증 원인을 물으면: voc_surge_score 확인 → voc_daily.sample_ids → get_ticket_detail → 요약.
6. 답변은 한국어 markdown. 아래 형식 준수.

## 응답 형식 (필수)
- markdown 사용: 표·굵게·리스트·백틱 코드 활용.
- 순서:
  1) **TL;DR** — 한 줄 결론
  2) **핵심 수치** — markdown 표 또는 bullet list (숫자만 나열 X, 라벨 함께)
  3) **왜 중요한가** — 1~2문장 해석
  4) **다음 액션** — 실행 가능한 제안 1~2개 (선택, 있을 때만)
- 식별자·SQL·티켓 ID는 백틱으로 감싸기.
- 표는 3~5행 이하로 요약. 원본 전체는 하단 CSV 다운로드로 안내.`;

// SSE — 이벤트를 짧게 자주 보내서 게이트웨이 idle timeout (30s) 방지
type SSEEvent =
  | { type: 'status'; step: number; message: string }
  | { type: 'tool_call'; name: string; args: unknown }
  | { type: 'tool_result'; name: string; ok: boolean; preview: string; rows?: unknown[] }
  | { type: 'token'; delta: string }
  | { type: 'done'; content: string; tool_trace: unknown[] }
  | { type: 'error'; message: string };

function sseEncode(ev: SSEEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(ev)}\n\n`);
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(
      sseEncode({ type: 'error', message: 'OPENAI_API_KEY not set' }),
      { status: 500, headers: sseHeaders() }
    );
  }

  let body: { messages?: Array<{ role: 'user' | 'assistant'; content: string }> };
  try {
    body = await req.json();
  } catch {
    return new Response(
      sseEncode({ type: 'error', message: 'invalid JSON' }),
      { status: 400, headers: sseHeaders() }
    );
  }
  const userMessages = (body.messages || []).filter(m => m.role === 'user' || m.role === 'assistant');
  if (userMessages.length === 0) {
    return new Response(
      sseEncode({ type: 'error', message: 'no messages' }),
      { status: 400, headers: sseHeaders() }
    );
  }

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || 'gpt-5-mini';

  // 에이전트 사용 트래킹용 — IP 익명 + 마지막 사용자 질문
  const ip = clientIp(req.headers);
  const lastUser = [...userMessages].reverse().find(m => m.role === 'user')?.content ?? '';

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: SSEEvent) => controller.enqueue(sseEncode(ev));

      // Keepalive ping while blocking (prevents idle-timeout)
      let ka: ReturnType<typeof setInterval> | null = null;
      const startKeepalive = (msg: string, step: number) => {
        ka = setInterval(() => send({ type: 'status', step, message: msg }), 7000);
      };
      const stopKeepalive = () => { if (ka) { clearInterval(ka); ka = null; } };

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const messages: any[] = [
          { role: 'system', content: SYSTEM_PROMPT },
          ...userMessages.map(m => ({ role: m.role, content: m.content })),
        ];
        const toolTrace: Array<{ name: string; input: unknown; output: unknown }> = [];
        let totalTokens = 0;

        for (let step = 0; step < 8; step++) {
          send({ type: 'status', step, message: '분석 중' });
          startKeepalive('분석 중', step);

          const resp = await client.chat.completions.create({
            model,
            messages,
            tools: TOOL_SCHEMA,
            tool_choice: 'auto',
          });

          stopKeepalive();
          totalTokens += resp.usage?.total_tokens ?? 0;

          const msg = resp.choices[0].message;
          messages.push(msg);

          if (!msg.tool_calls || msg.tool_calls.length === 0) {
            const text = (msg.content ?? '').trim() || '(응답 없음)';
            // 에이전트 질의 트래킹 — 입력·LLM이 생성한 SQL·토큰·응답 미리보기
            const sqls = toolTrace
              .filter(t => t.name === 'run_bigquery')
              .map(t => (t.input as { sql?: string })?.sql || '')
              .filter(Boolean);
            await logEvent({
              ts: Date.now(),
              ip,
              type: 'agent_query',
              prompt: lastUser.slice(0, 500),
              sql: sqls.join(' ||| ').slice(0, 2000),
              steps: toolTrace.length,
              tokens: totalTokens,
              answer_preview: text.slice(0, 300),
            });
            // Emit final content in one chunk (streamed token delta not needed since already blocking-complete)
            send({ type: 'token', delta: text });
            send({ type: 'done', content: text, tool_trace: toolTrace });
            controller.close();
            return;
          }

          for (const tc of msg.tool_calls) {
            if (tc.type !== 'function') continue;
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* ignore */ }

            send({ type: 'tool_call', name: tc.function.name, args });
            startKeepalive(`도구 ${tc.function.name}`, step);
            const result = await runTool(tc.function.name, args);
            stopKeepalive();

            toolTrace.push({ name: tc.function.name, input: args, output: result });

            const preview = (() => {
              if ('ok' in result && result.ok && 'rows' in result) {
                return `${result.row_count}행`;
              }
              if ('ok' in result && !result.ok) return `error: ${result.error}`;
              return 'ok';
            })();
            // rows include: 클라이언트가 CSV 다운로드에 사용. 크기 관리 위해 100행 cap.
            const rows =
              'ok' in result && result.ok && 'rows' in result && Array.isArray(result.rows)
                ? (result.rows as unknown[]).slice(0, 100)
                : undefined;
            send({
              type: 'tool_result',
              name: tc.function.name,
              ok: 'ok' in result && result.ok,
              preview,
              rows,
            });

            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: JSON.stringify(result).slice(0, 12_000),
            });
          }
        }

        send({ type: 'error', message: '에이전트가 8회 도구 호출 후에도 결론을 내지 못했습니다.' });
        controller.close();
      } catch (e: unknown) {
        stopKeepalive();
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[api/chat] error:', msg);
        try { send({ type: 'error', message: msg }); } catch { /* stream already closed */ }
        try { controller.close(); } catch { /* already */ }
      }
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}

function sseHeaders() {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering
  };
}
