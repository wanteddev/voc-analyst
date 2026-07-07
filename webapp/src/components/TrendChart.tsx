"use client";

import { useMemo, useRef, useState } from 'react';

// 손수 그린 라인 차트 with crosshair + tooltip.
// dataviz 스킬 권장: 2px 라인, 3px 포인트, 강조된 endpoint, hover tooltip.
type Point = { x: string; y: number };

export function TrendChart({
  points,
  height = 200,
  emphasize = true,
  baseline,
  color = 'var(--accent)',
  ariaLabel = '트렌드 차트',
  yFormat,
  onPointClick,
  activeIndex,
}: {
  points: Point[];
  height?: number;
  emphasize?: boolean;
  baseline?: { y: number; label?: string };
  color?: string;
  ariaLabel?: string;
  yFormat?: (v: number) => string;
  onPointClick?: (index: number, point: Point) => void;
  activeIndex?: number | null;
}) {
  const [hover, setHover] = useState<{ i: number; cx: number; cy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const width = 640;
  const padL = 40, padR = 24, padT = 20, padB = 30;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  const geom = useMemo(() => {
    const maxY = Math.max(1, ...points.map(p => p.y), baseline?.y ?? 0);
    const step = points.length > 1 ? chartW / (points.length - 1) : 0;
    const yScale = (v: number) => padT + chartH - (v / maxY) * chartH;
    const xAt = (i: number) => padL + i * step;
    const linePath = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)},${yScale(p.y).toFixed(1)}`)
      .join(' ');
    const areaPath = points.length
      ? `${linePath} L ${xAt(points.length - 1).toFixed(1)},${(padT + chartH).toFixed(1)} L ${padL.toFixed(1)},${(padT + chartH).toFixed(1)} Z`
      : '';
    return { maxY, step, yScale, xAt, linePath, areaPath };
  }, [points, baseline?.y, chartW, chartH]);

  if (points.length === 0) {
    return (
      <div style={{ color: 'var(--text-mute)', fontSize: 12, padding: '32px 8px' }}>
        데이터 없음
      </div>
    );
  }

  const ticks = 4;
  const yTicks = Array.from({ length: ticks }, (_, i) => Math.round((geom.maxY / (ticks - 1)) * i));
  const gradId = `grad-${points.length}-${(baseline?.y ?? 0).toFixed(0)}`;
  const endpoint = points[points.length - 1];
  const fmt = yFormat ?? ((v: number) => String(v));

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    if (relX < padL - 8 || relX > width - padR + 8) {
      setHover(null);
      return;
    }
    // Nearest point
    const i = Math.max(0, Math.min(points.length - 1, Math.round((relX - padL) / geom.step)));
    setHover({ i, cx: geom.xAt(i), cy: geom.yScale(points[i].y) });
  }

  return (
    <div className="chart" style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="xMidYMid meet"
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        style={{ cursor: 'crosshair' }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Y-grid + labels */}
        <g stroke="var(--border)" strokeWidth="1" strokeDasharray="2 4">
          {yTicks.slice(1).map(v => (
            <line key={v} x1={padL} y1={geom.yScale(v)} x2={width - padR} y2={geom.yScale(v)} />
          ))}
        </g>
        <g fill="var(--text-mute)" fontFamily="ui-monospace, monospace" fontSize="10">
          {yTicks.map(v => (
            <text key={v} x={padL - 6} y={geom.yScale(v) + 3} textAnchor="end">{v}</text>
          ))}
        </g>

        {/* Baseline */}
        {baseline && (
          <>
            <line
              x1={padL} y1={geom.yScale(baseline.y)}
              x2={width - padR} y2={geom.yScale(baseline.y)}
              stroke="var(--text-mute)" strokeWidth="1" strokeDasharray="4 4" opacity="0.6"
            />
            {baseline.label && (
              <text
                x={width - padR} y={geom.yScale(baseline.y) - 6}
                fill="var(--text-mute)" fontFamily="ui-monospace, monospace" fontSize="10"
                textAnchor="end"
              >{baseline.label}</text>
            )}
          </>
        )}

        {/* Area + line */}
        <path d={geom.areaPath} fill={`url(#${gradId})`} />
        <path d={geom.linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />

        {/* Points */}
        <g fill="var(--panel)" stroke={color} strokeWidth="1.5">
          {points.map((p, i) => (
            <circle
              key={i}
              cx={geom.xAt(i)}
              cy={geom.yScale(p.y)}
              r={activeIndex === i ? 6 : 3}
              fill={activeIndex === i ? color : 'var(--panel)'}
              style={{ cursor: onPointClick ? 'pointer' : 'default' }}
              onClick={onPointClick ? (e) => { e.stopPropagation(); onPointClick(i, p); } : undefined}
            />
          ))}
        </g>
        {/* Larger invisible hit-targets for easier click */}
        {onPointClick && (
          <g fill="transparent">
            {points.map((p, i) => (
              <circle
                key={`hit-${i}`}
                cx={geom.xAt(i)}
                cy={geom.yScale(p.y)}
                r={12}
                style={{ cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); onPointClick(i, p); }}
              />
            ))}
          </g>
        )}

        {/* Endpoint emphasis */}
        {emphasize && endpoint && (
          <>
            <circle
              cx={geom.xAt(points.length - 1)} cy={geom.yScale(endpoint.y)} r="5"
              fill={color} stroke="var(--panel)" strokeWidth="2"
            />
            {!hover && (
              <text
                x={geom.xAt(points.length - 1)} y={geom.yScale(endpoint.y) - 12}
                textAnchor="middle" fill={color}
                fontFamily="ui-monospace, monospace" fontSize="12" fontWeight="600"
              >{fmt(endpoint.y)}</text>
            )}
          </>
        )}

        {/* Crosshair + hover point + tooltip */}
        {hover && (
          <g>
            <line
              x1={hover.cx} y1={padT} x2={hover.cx} y2={padT + chartH}
              stroke="var(--text-mute)" strokeWidth="1" strokeDasharray="2 3" opacity="0.7"
            />
            <circle cx={hover.cx} cy={hover.cy} r="6" fill={color}
                    stroke="var(--panel)" strokeWidth="2.5" />
          </g>
        )}
      </svg>

      {/* Tooltip (HTML overlay) */}
      {hover && (
        <div
          style={{
            position: 'absolute',
            left: `${(hover.cx / width) * 100}%`,
            top: `${(hover.cy / height) * 100}%`,
            transform: `translate(-50%, calc(-100% - 14px))`,
            background: 'var(--panel-2)',
            border: '1px solid var(--border-strong)',
            borderRadius: 6,
            padding: '6px 10px',
            fontFamily: 'var(--mono)',
            fontSize: 11.5,
            color: 'var(--text)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
            zIndex: 2,
          }}
        >
          <div style={{ color: 'var(--text-mute)', fontSize: 10.5 }}>{points[hover.i].x}</div>
          <div style={{ color, fontWeight: 500 }}>{fmt(points[hover.i].y)}</div>
        </div>
      )}

      <div className="chart-axis">
        {points.filter((_, i) => i % Math.max(1, Math.ceil(points.length / 5)) === 0 || i === points.length - 1).map((p, i) => (
          <span key={`${p.x}-${i}`}>{p.x}</span>
        ))}
      </div>
    </div>
  );
}
