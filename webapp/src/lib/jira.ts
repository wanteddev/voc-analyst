// Atlassian Cloud REST API v3 클라이언트 — LIVE 프로젝트 이슈 생성.
// wanted-insights-bot의 jira-manager 에이전트 패턴 참고.

const CLOUD_ID = 'wantedlab.atlassian.net';

export type CreateIssueInput = {
  category1: string;
  category2: string;
  category3: string;
  recent_7d: number;
  baseline_daily_avg: number;
  ratio: number;
  recent_negative_ratio: number | null;
  surge_level: 'SURGE' | 'WATCH' | 'IMPROVED';
  sampleTicketIds?: string[];
  reporterEmail?: string;
};

export type JiraIssue = {
  key: string;
  id: string;
  url: string;
};

function auth(): string {
  const email = process.env.ATLASSIAN_EMAIL;
  const token = process.env.ATLASSIAN_API_TOKEN;
  if (!email || !token) throw new Error('ATLASSIAN_EMAIL / ATLASSIAN_API_TOKEN not set');
  return 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
}

function buildDescription(input: CreateIssueInput): unknown {
  const negPct = input.recent_negative_ratio != null
    ? `${(input.recent_negative_ratio * 100).toFixed(0)}%`
    : '—';

  const paragraphs: unknown[] = [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'VOC Dashboard에서 자동 생성된 급증 대응 이슈.', marks: [{ type: 'em' }] },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '급증 지표' }],
    },
    {
      type: 'bulletList',
      content: [
        `카테고리: ${input.category1} / ${input.category2} / ${input.category3}`,
        `심각도: ${input.surge_level}`,
        `최근 7일 티켓: ${input.recent_7d}건`,
        `Baseline: ${input.baseline_daily_avg.toFixed(2)} 건/일`,
        `Ratio: ${input.ratio.toFixed(2)}×`,
        `부정 감정 비율: ${negPct}`,
      ].map(text => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      })),
    },
  ];

  if (input.sampleTicketIds && input.sampleTicketIds.length > 0) {
    paragraphs.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '대표 Zendesk 티켓' }],
    });
    paragraphs.push({
      type: 'bulletList',
      content: input.sampleTicketIds.slice(0, 5).map(id => ({
        type: 'listItem',
        content: [{
          type: 'paragraph',
          content: [{
            type: 'text',
            text: id,
            marks: [{ type: 'link', attrs: { href: `https://wantedlab.zendesk.com/agent/tickets/${id}` } }],
          }],
        }],
      })),
    });
  }

  paragraphs.push({
    type: 'paragraph',
    content: [
      { type: 'text', text: '데이터 소스: ' },
      { type: 'text', text: 'wanted-data.wanted_ml_voc.voc_surge_score', marks: [{ type: 'code' }] },
    ],
  });

  return {
    type: 'doc',
    version: 1,
    content: paragraphs,
  };
}

export async function createJiraIssue(input: CreateIssueInput): Promise<JiraIssue> {
  const projectKey = process.env.JIRA_PROJECT_KEY || 'LIVE';
  const summary = `[VOC] ${input.category2}/${input.category3} 급증 (${input.ratio.toFixed(1)}×, ${input.recent_7d}건/7d)`;

  // LIVE project issue types: Failure, 개선(Improvement), 버그(Bug), 하위 작업.
  // 기본 Failure — 고객 접점 품질 이슈. env로 override 가능.
  const issueTypeName = process.env.JIRA_ISSUE_TYPE || 'Failure';

  const body = {
    fields: {
      project: { key: projectKey },
      summary,
      description: buildDescription(input),
      issuetype: { name: issueTypeName },
      labels: [
        'voc',
        `voc-category-${input.category3.replace(/[^가-힣A-Za-z0-9]/g, '_')}`,
        `voc-severity-${input.surge_level.toLowerCase()}`,
      ],
    },
  };

  const resp = await fetch(
    `https://${CLOUD_ID}/rest/api/3/issue`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': auth(),
      },
      body: JSON.stringify(body),
    }
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Jira create failed ${resp.status}: ${text.slice(0, 500)}`);
  }
  const data = await resp.json();
  return {
    key: data.key,
    id: data.id,
    url: `https://${CLOUD_ID}/browse/${data.key}`,
  };
}
