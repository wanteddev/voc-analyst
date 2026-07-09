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
]);

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

export async function POST(req: NextRequest) {
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
    ip: clientIp(req.headers),
    type,
    path: str(body.path, 200),
    filters: str(body.filters, 300),
    detail: str(body.detail, 200),
    ua: str(req.headers.get('user-agent'), 200),
  });

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
