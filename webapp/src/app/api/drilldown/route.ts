import { NextRequest, NextResponse } from 'next/server';
import {
  fetchCategoryTrend,
  fetchCategoryKeywords,
  fetchCategoryTickets,
} from '@/lib/queries';

export const runtime = 'nodejs';
export const revalidate = 0;

const ALLOWED_CATEGORY1 = new Set(['유저', '기업']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const category1Raw = searchParams.get('category1');
  const category2 = searchParams.get('category2');
  const category3 = searchParams.get('category3');
  const focus = searchParams.get('focus');
  const weekStartRaw = searchParams.get('weekStart');

  if (!category2 || category2.length > 50) {
    return NextResponse.json({ error: 'category2 required (≤50자)' }, { status: 400 });
  }
  if (category3 && category3.length > 50) {
    return NextResponse.json({ error: 'category3 ≤50자' }, { status: 400 });
  }
  const category1 = category1Raw && ALLOWED_CATEGORY1.has(category1Raw) ? category1Raw : null;
  const onlyNegative = focus === 'negative';
  const weekStart = weekStartRaw && DATE_RE.test(weekStartRaw) ? weekStartRaw : null;

  try {
    const [trend, keywords, tickets] = await Promise.all([
      fetchCategoryTrend({ category1, category2, category3 }),
      category3 ? fetchCategoryKeywords({ category3 }) : Promise.resolve([]),
      fetchCategoryTickets({ category1, category2, category3, onlyNegative, weekStart }),
    ]);
    return NextResponse.json(
      { trend, keywords, tickets },
      { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=60' } }
    );
  } catch (e: unknown) {
    console.error('[api/drilldown] error:', e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
