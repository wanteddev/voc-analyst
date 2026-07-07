import { NextRequest, NextResponse } from 'next/server';
import { createJiraIssue, type CreateIssueInput } from '@/lib/jira';
import { bq } from '@/lib/bq';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let input: CreateIssueInput;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  if (!input.category3 || typeof input.recent_7d !== 'number') {
    return NextResponse.json({ error: 'category3, recent_7d required' }, { status: 400 });
  }

  try {
    const issue = await createJiraIssue(input);

    // voc_actions 테이블에 INSERT — 성과 트래킹용
    await bq().dataset('wanted_ml_voc').table('voc_actions').insert([{
      action_id: issue.key,
      jira_key: issue.key,
      jira_url: issue.url,
      category1: input.category1,
      category2: input.category2,
      category3: input.category3,
      created_by: input.reporterEmail || 'voc-dashboard',
      created_at: new Date().toISOString(),
      baseline_ticket_rate: input.baseline_daily_avg,
      effect_label: 'pending',
    }]);

    return NextResponse.json(issue, { status: 201 });
  } catch (e: unknown) {
    console.error('[api/jira/create] error:', e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
