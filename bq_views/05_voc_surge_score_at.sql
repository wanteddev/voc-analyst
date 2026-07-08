-- voc_surge_score_at(as_of DATE, emo STRING) — 임의 시점 스냅샷 (as-of INCLUSIVE, Option Y)
-- recent_7d = [as_of - 6, as_of] = 7일 (asOf 포함)
-- baseline_28d = [as_of - 34, as_of - 7] = 28일
-- emo: '부정'|'긍정'|'중립' 지정 시 해당 감정 티켓만 집계, NULL이면 전체.
--
-- 사용:
--   SELECT * FROM `wanted-data.wanted_ml_voc.voc_surge_score_at`(DATE('2026-06-01'), NULL)
--   SELECT * FROM `wanted-data.wanted_ml_voc.voc_surge_score_at`(DATE('2026-06-01'), '부정')
--
-- as_of = CURRENT_DATE('Asia/Seoul'), emo = NULL 이면 voc_surge_score view와 동일 결과.

CREATE OR REPLACE TABLE FUNCTION `wanted-data.wanted_ml_voc.voc_surge_score_at`(as_of DATE, emo STRING)
AS (
  WITH daily_cat AS (
    SELECT
      date, category1, category2, category3,
      SUM(tickets) AS tickets,
      SUM(negative_tickets) AS negative_tickets
    FROM `wanted-data.wanted_ml_voc.voc_daily`
    WHERE date >= DATE_SUB(as_of, INTERVAL 34 DAY)
      AND date <= as_of
      AND (emo IS NULL OR emotion = emo)
    GROUP BY date, category1, category2, category3
  ),
  categories AS (
    SELECT DISTINCT category1, category2, category3 FROM daily_cat
  ),
  date_grid AS (
    SELECT d AS date
    FROM UNNEST(GENERATE_DATE_ARRAY(
      DATE_SUB(as_of, INTERVAL 34 DAY),
      as_of
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
        WHEN date >= DATE_SUB(as_of, INTERVAL 6 DAY)
          THEN tickets ELSE 0 END) AS recent_7d,
      SUM(CASE
        WHEN date >= DATE_SUB(as_of, INTERVAL 6 DAY)
          THEN negative_tickets ELSE 0 END) AS recent_7d_negative,
      SUM(CASE
        WHEN date < DATE_SUB(as_of, INTERVAL 6 DAY)
          THEN tickets ELSE 0 END) AS baseline_28d,
      AVG(CASE
        WHEN date < DATE_SUB(as_of, INTERVAL 6 DAY)
          THEN tickets END) AS baseline_daily_avg,
      STDDEV(CASE
        WHEN date < DATE_SUB(as_of, INTERVAL 6 DAY)
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
  WHERE recent_7d + baseline_28d > 0
);
