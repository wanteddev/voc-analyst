import { NextRequest, NextResponse } from 'next/server';
import { logEvent, clientIp } from '@/lib/events';

export const runtime = 'nodejs';
export const revalidate = 0;

// 클라이언트 사용 이벤트 수집. 식별은 IP 익명 (헤더에서 stamp).
// sendBeacon/fetch(keepalive)로 전송되며 실패해도 사용자 영향 없음.
const ALLOWED_TYPES = new Set([
  'page_view',
  'drilldown_open',
  'keyword_select',
  'chat_open',
  'client_error',
]);

// 봇/스크린샷터 제외 — headless 렌더러가 TrackView를 실행해 사용 지표를 오염시키므로.
const BOT_UA = /bot|crawl|spider|slurp|screenshot|headless|preview|monitor|lighthouse/i;

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

export async function POST(req: NextRequest) {
  const ua = req.headers.get('user-agent') || '';
  if (BOT_UA.test(ua)) {
    return NextResponse.json({ ok: true, skipped: 'bot' }, { headers: { 'Cache-Control': 'no-store' } });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* sendBeacon Blob도 JSON으로 파싱됨; 실패 시 빈 body */
  }

  const type = typeof body.type === 'string' && ALLOWED_TYPES.has(body.type) ? body.type : null;
  if (!type) {
    return NextResponse.json({ ok: false, error: 'invalid type' }, { status: 400 });
  }

  await logEvent({
    ts: Date.now(),
    vid: str(body.vid, 64),
    ip: clientIp(req.headers),
    type,
    path: str(body.path, 200),
    filters: str(body.filters, 300),
    detail: str(body.detail, 300),
    ua: ua.slice(0, 200),
  });

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
