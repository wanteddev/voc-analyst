import { cookies } from 'next/headers';
import { isAdminCookie, adminConfigured, ADMIN_COOKIE } from '@/lib/admin';
import { recentEvents, streamLength, aggregateUsage } from '@/lib/events';
import { AdminLogin } from './AdminLogin';
import { AdminLogout } from './AdminLogout';
import { TrendChart } from '@/components/TrendChart';

export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, string> = {
  page_view: '페이지 조회',
  drilldown_open: '드릴다운 열기',
  chat_open: '채팅 열기',
  agent_query: '에이전트 질의',
};

function fmtKst(ms: string): string {
  const n = Number(ms);
  if (!n) return '—';
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(n));
  } catch {
    return '—';
  }
}

const th: React.CSSProperties = {
  textAlign: 'left', padding: '6px 10px', color: 'var(--text-mute)',
  fontFamily: 'var(--mono)', fontSize: 10.5, fontWeight: 500,
  borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  padding: '7px 10px', fontSize: 12.5, borderBottom: '1px solid var(--border)',
  verticalAlign: 'top',
};

export default async function AdminPage() {
  const authed = isAdminCookie(cookies().get(ADMIN_COOKIE)?.value);
  if (!authed) {
    return (
      <div className="page">
        <AdminLogin configured={adminConfigured()} />
      </div>
    );
  }

  const [events, total] = await Promise.all([recentEvents(1000), streamLength()]);
  const u = aggregateUsage(events);

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <p className="eyebrow" style={{ margin: 0 }}>Admin · 사용 현황</p>
        <span className="hint">IP 익명 기준 · 최근 {u.sampled}건 표본 · 스트림 총 {total.toLocaleString()}건</span>
        <span style={{ marginLeft: 'auto' }}><AdminLogout /></span>
      </div>

      {/* KPI 요약 */}
      <div className="kpi-row" style={{ marginTop: 4 }}>
        <div className="kpi">
          <div className="lbl">순 방문 IP</div>
          <div className="num">{u.unique_ips}</div>
        </div>
        {(['page_view', 'drilldown_open', 'chat_open', 'agent_query'] as const).map(t => (
          <div className="kpi" key={t}>
            <div className="lbl">{TYPE_LABEL[t]}</div>
            <div className="num">{u.by_type[t] ?? 0}</div>
          </div>
        ))}
      </div>

      {/* 일별 이용 추이 */}
      <section className="card">
        <div className="section-hdr">
          <h2>일별 이용 추이</h2>
          <span className="hint">이벤트 수 · 최근 {u.daily.length}일 · IP 익명</span>
        </div>
        {u.daily.length === 0 ? (
          <p style={{ color: 'var(--text-mute)', fontSize: 12 }}>데이터 없음</p>
        ) : (
          <TrendChart
            points={u.daily.map(d => ({ x: d.date.slice(5), y: d.count }))}
            ariaLabel="일별 이용 이벤트 추이"
            yFormat={(v) => `${v}건`}
          />
        )}
      </section>

      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 14, marginTop: 4,
      }}>
        {/* Top filters */}
        <section className="card">
          <div className="section-hdr"><h2>많이 본 필터 조합</h2><span className="hint">page_view 기준</span></div>
          {u.top_filters.length === 0 ? (
            <p style={{ color: 'var(--text-mute)', fontSize: 12 }}>데이터 없음</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>필터</th><th style={{ ...th, textAlign: 'right' }}>횟수</th></tr></thead>
              <tbody>
                {u.top_filters.map((r, i) => (
                  <tr key={i}>
                    <td style={{ ...td, fontFamily: 'var(--mono)', fontSize: 11, wordBreak: 'break-all' }}>{r.key}</td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--mono)' }}>{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Top drilldowns */}
        <section className="card">
          <div className="section-hdr"><h2>많이 연 드릴다운</h2><span className="hint">대분류/중분류/소분류</span></div>
          {u.top_drilldowns.length === 0 ? (
            <p style={{ color: 'var(--text-mute)', fontSize: 12 }}>데이터 없음</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>카테고리</th><th style={{ ...th, textAlign: 'right' }}>횟수</th></tr></thead>
              <tbody>
                {u.top_drilldowns.map((r, i) => (
                  <tr key={i}>
                    <td style={td}>{r.key}</td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--mono)' }}>{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {/* Agent queries */}
      <section className="card">
        <div className="section-hdr">
          <h2>최근 에이전트 질의</h2>
          <span className="hint">입력·생성 SQL·토큰</span>
        </div>
        {u.recent_agent_queries.length === 0 ? (
          <p style={{ color: 'var(--text-mute)', fontSize: 12 }}>아직 에이전트 질의 없음</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>시각(KST)</th>
                <th style={th}>IP</th>
                <th style={th}>질문</th>
                <th style={{ ...th, textAlign: 'right' }}>토큰</th>
                <th style={{ ...th, textAlign: 'right' }}>도구</th>
              </tr>
            </thead>
            <tbody>
              {u.recent_agent_queries.map((q, i) => (
                <tr key={i}>
                  <td style={{ ...td, fontFamily: 'var(--mono)', fontSize: 11, whiteSpace: 'nowrap' }}>{fmtKst(q.ts)}</td>
                  <td style={{ ...td, fontFamily: 'var(--mono)', fontSize: 11 }}>{q.ip}</td>
                  <td style={td}>
                    <div>{q.prompt || '—'}</div>
                    {q.sql && (
                      <details style={{ marginTop: 4 }}>
                        <summary style={{ cursor: 'pointer', color: 'var(--text-mute)', fontSize: 11 }}>생성 SQL</summary>
                        <pre style={{
                          whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: '4px 0 0',
                          fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-dim)',
                          background: 'var(--panel-2)', padding: 8, borderRadius: 4,
                        }}>{q.sql}</pre>
                      </details>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--mono)' }}>{q.tokens || '—'}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--mono)' }}>{q.steps || '0'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="foot">
        <span>IP 익명 트래킹 · Redis Stream <code>voc:events</code> · MAXLEN ~200k</span>
        <span>관리자 전용</span>
      </div>
    </div>
  );
}
