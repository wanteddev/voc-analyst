-- voc_surge_score — 카테고리별 급증 감지 스코어 (as-of INCLUSIVE, Option Y)
-- recent_7d = [today - 6, today] = 7일 (asOf 포함)
-- baseline_28d = [today - 34, today - 7] = 28일
-- Consumer: Slack 일간 알람(SURGE/WATCH 트리거), Product Insights 탭 (default view)
-- Depends on: voc_daily

CREATE OR REPLACE VIEW `wanted-data.wanted_ml_voc.voc_surge_score` AS
WITH daily_cat AS (
  SELECT
    date, category1, category2, category3,
    SUM(tickets) AS tickets,
    SUM(negative_tickets) AS negative_tickets
  FROM `wanted-data.wanted_ml_voc.voc_daily`
  WHERE date >= DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 34 DAY)
    AND date <= CURRENT_DATE('Asia/Seoul')
  GROUP BY date, category1, category2, category3
),
categories AS (
  SELECT DISTINCT category1, category2, category3 FROM daily_cat
),
date_grid AS (
  SELECT d AS date
  FROM UNNEST(GENERATE_DATE_ARRAY(
    DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 34 DAY),
    CURRENT_DATE('Asia/Seoul')
  )) AS d
),
zero_filled AS (
  SELECT
    c.category1, c.category2, c.category3, g.date,
    COALESCE(d.tickets, 0) AS tickets,
    COALESCE(d.negative_tickets, 0) AS negative_tickets
  FROM categories c
  CROSS JOIN date_grid g
  LEFT JOIN daily_cat d
    USING (category1, category2, category3, date)
),
windows AS (
  SELECT
    category1, category2, category3,
    SUM(CASE
      WHEN date >= DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 6 DAY)
        THEN tickets ELSE 0 END) AS recent_7d,
    SUM(CASE
      WHEN date >= DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 6 DAY)
        THEN negative_tickets ELSE 0 END) AS recent_7d_negative,
    SUM(CASE
      WHEN date < DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 6 DAY)
        THEN tickets ELSE 0 END) AS baseline_28d,
    AVG(CASE
      WHEN date < DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 6 DAY)
        THEN tickets END) AS baseline_daily_avg,
    STDDEV(CASE
      WHEN date < DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 6 DAY)
        THEN tickets END) AS baseline_daily_stddev
  FROM zero_filled
  GROUP BY category1, category2, category3
)
SELECT
  category1, category2, category3,
  recent_7d,
  recent_7d_negative,
  baseline_28d,
  ROUND(recent_7d / 7.0, 2) AS recent_daily_avg,
  ROUND(baseline_daily_avg, 2) AS baseline_daily_avg,
  ROUND(baseline_daily_stddev, 2) AS baseline_daily_stddev,
  ROUND(SAFE_DIVIDE(
    recent_7d / 7.0 - baseline_daily_avg,
    NULLIF(baseline_daily_stddev, 0)
  ), 2) AS z_score,
  ROUND(SAFE_DIVIDE(
    recent_7d / 7.0,
    GREATEST(baseline_daily_avg, 0.25)
  ), 2) AS ratio,
  ROUND(SAFE_DIVIDE(recent_7d_negative, NULLIF(recent_7d, 0)), 3) AS recent_negative_ratio,
  CASE
    WHEN category3 = '(미분류)' OR category2 = '(미분류)' THEN 'STABLE'
    WHEN recent_7d >= 5
     AND SAFE_DIVIDE(recent_7d / 7.0, GREATEST(baseline_daily_avg, 0.25)) >= 2.0
      THEN 'SURGE'
    WHEN recent_7d >= 3
     AND SAFE_DIVIDE(recent_7d / 7.0, GREATEST(baseline_daily_avg, 0.25)) >= 1.5
      THEN 'WATCH'
    WHEN baseline_28d >= 20
     AND recent_7d < baseline_daily_avg * 7 * 0.5
      THEN 'IMPROVED'
    ELSE 'STABLE'
  END AS surge_level
FROM windows
WHERE recent_7d + baseline_28d > 0;
