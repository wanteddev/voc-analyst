-- voc_keyword_trend — 키워드 UNNEST + 주간 트렌드
-- keywords 컬럼(콤마 구분)을 UNNEST하여 개별 키워드 mention count 집계
-- Consumer: Product Insights 탭 (신규 키워드/급증 키워드), 분석 에이전트 컨텍스트

CREATE OR REPLACE VIEW `wanted-data.wanted_ml_voc.voc_keyword_trend` AS
WITH exploded AS (
  SELECT
    DATE_TRUNC(DATE(event_create_time, 'Asia/Seoul'), WEEK(MONDAY)) AS week_start,
    id,
    TRIM(kw) AS keyword,
    COALESCE(category1, '(미분류)') AS category1,
    COALESCE(category2, '(미분류)') AS category2,
    COALESCE(category3, '(미분류)') AS category3,
    overall_emotion
  FROM `wanted-data.wanted_ml.zendesk_voc_classified`,
       UNNEST(SPLIT(keywords, ',')) AS kw
  -- 롤링: 6개월 as-of 지원 위해 180일. 기존 90일 → 확대. UNNEST 비용 약 2배.
  WHERE event_create_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 180 DAY)
    AND keywords IS NOT NULL AND keywords != ''
    AND LENGTH(TRIM(kw)) >= 2
)
SELECT
  week_start,
  keyword,
  COUNT(*) AS mentions,
  COUNT(DISTINCT id) AS distinct_tickets,
  COUNTIF(overall_emotion = '부정') AS negative_mentions,
  APPROX_TOP_COUNT(category3, 1)[SAFE_OFFSET(0)].value AS top_category3,
  APPROX_TOP_COUNT(category1, 1)[SAFE_OFFSET(0)].value AS top_category1
FROM exploded
GROUP BY week_start, keyword
HAVING mentions >= 2;
