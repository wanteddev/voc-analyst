import { NextRequest, NextResponse } from 'next/server';
import { recentEvents, streamLength, aggregateUsage } from '@/lib/events';
import { isAdminCookie, ADMIN_COOKIE } from '@/lib/admin';

export const runtime = 'nodejs';
export const revalidate = 0;

// 사용 현황 리포팅 — 관리자 쿠키 필요. (IP 익명 기준)
export async function GET(req: NextRequest) {
  if (!isAdminCookie(req.cookies.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const [events, total] = await Promise.all([recentEvents(1000), streamLength()]);
  return NextResponse.json(
    { stream_total: total, ...aggregateUsage(events) },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
