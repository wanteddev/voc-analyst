// 페이지 전환 시 자동 노출되는 skeleton. Next.js App Router 컨벤션.
// 실제 페이지와 동일한 grid 구조 + 회색 블록으로 지각 성능 개선.

function Bar({ w = '100%', h = 14, r = 6 }: { w?: string | number; h?: number; r?: number }) {
  return (
    <div
      className="skeleton-bar"
      style={{
        width: w,
        height: h,
        borderRadius: r,
      }}
    />
  );
}

export default function ProductLoading() {
  return (
    <div className="page skeleton">
      <style>{`
        @keyframes skeleton-pulse {
          0%   { opacity: 0.6; }
          50%  { opacity: 1.0; }
          100% { opacity: 0.6; }
        }
        .skeleton-bar {
          background: linear-gradient(90deg,
            var(--panel-2) 0%, var(--panel) 50%, var(--panel-2) 100%);
          background-size: 200% 100%;
          animation: skeleton-pulse 1.4s ease-in-out infinite;
        }
        .skeleton .card, .skeleton .kpi, .skeleton .watch-item {
          animation: skeleton-pulse 1.4s ease-in-out infinite;
        }
      `}</style>

      {/* eyebrow */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Bar w={220} h={12} />
        <Bar w={180} h={26} r={8} />
        <Bar w={340} h={26} r={8} />
      </div>

      {/* MTD line */}
      <Bar w={420} h={12} />

      {/* Status overview 4 KPI */}
      <section>
        <div style={{ marginBottom: 12 }}><Bar w={220} h={16} /></div>
        <div className="kpi-row">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="kpi">
              <Bar w={100} h={10} />
              <Bar w={60} h={26} />
              <Bar w={140} h={11} />
            </div>
          ))}
        </div>
      </section>

      {/* NegMatrix placeholder */}
      <section>
        <div style={{ marginBottom: 12 }}><Bar w={280} h={16} /></div>
        <div className="card">
          <Bar w="100%" h={280} r={4} />
        </div>
      </section>

      {/* Grid placeholder */}
      <section>
        <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Bar w={110} h={16} />
          <Bar w={260} h={26} r={8} />
        </div>
        <div className="watch-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="watch-item" style={{ borderLeftColor: 'var(--border)' }}>
              <Bar w={160} h={14} />
              <Bar w={40} h={14} />
              <div style={{ gridColumn: '1 / -1' }}><Bar w="100%" h={10} /></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
