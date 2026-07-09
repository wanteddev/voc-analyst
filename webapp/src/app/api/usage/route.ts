import { NextResponse } from 'next/server';
import { recentEvents, streamLength } from '@/lib/events';

export const runtime = 'nodejs';
export const revalidate = 0;

// 사용 현황 리포팅 — 최근 이벤트를 집계해 반환. (IP 익명 기준)
export async function GET() {
  const [events, total] = await Promise.all([recentEvents(1000), streamLength()]);

  const byType: Record<string, number> = {};
  const ips = new Set<string>();
  const filterCount: Record<string, number> = {};
  const drilldownCount: Record<string, number> = {};
  const agentQueries: Array<{
    ts: string; ip: string; prompt: string; tokens: string; steps: string;
  }> = [];

  for (const { fields: f } of events) {
    if (f.type) byType[f.type] = (byType[f.type] ?? 0) + 1;
    if (f.ip) ips.add(f.ip);
    if (f.type === 'page_view') {
      const key = f.filters || '(필터 없음)';
      filterCount[key] = (filterCount[key] ?? 0) + 1;
    }
    if (f.type === 'drilldown_open' && f.detail) {
      drilldownCount[f.detail] = (drilldownCount[f.detail] ?? 0) + 1;
    }
    if (f.type === 'agent_query') {
      agentQueries.push({
        ts: f.ts ?? '', ip: f.ip ?? '', prompt: f.prompt ?? '',
        tokens: f.tokens ?? '', steps: f.steps ?? '',
      });
    }
  }

  const topN = (m: Record<string, number>, n: number) =>
    Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, count]) => ({ key: k, count }));

  return NextResponse.json(
    {
      stream_total: total,
      sampled: events.length,
      unique_ips: ips.size,
      by_type: byType,
      top_filters: topN(filterCount, 15),
      top_drilldowns: topN(drilldownCount, 15),
      recent_agent_queries: agentQueries.slice(0, 20),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
