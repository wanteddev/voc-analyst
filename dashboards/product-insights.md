# Product Insights 대시보드

**타겟**: PM / 기획팀
**목적**: 카테고리 트렌드 추적, 급증 이슈 발굴, 반복 이슈 패턴 확인

## 위젯

### 1. 급증 카테고리 top-10 (SURGE/WATCH)

- 타입: Table (색상 accent by surge_level)
- SQL:
  ```sql
  SELECT
    surge_level,
    category2,
    category3,
    recent_7d,
    baseline_daily_avg,
    ratio,
    z_score,
    recent_negative_ratio
  FROM `wanted-data.wanted_ml_voc.voc_surge_score`
  WHERE surge_level IN ('SURGE', 'WATCH')
  ORDER BY
    CASE surge_level WHEN 'SURGE' THEN 0 WHEN 'WATCH' THEN 1 ELSE 2 END,
    ratio DESC
  LIMIT 15
  ```

### 2. 카테고리별 4주 트렌드 (line chart)

- 타입: Line (multi-series by category3)
- SQL:
  ```sql
  SELECT
    DATE_TRUNC(date, WEEK(MONDAY)) AS week,
    category3,
    SUM(tickets) AS tickets
  FROM `wanted-data.wanted_ml_voc.voc_daily`
  WHERE date >= DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 12 WEEK)
    AND category3 IN (
      SELECT category3 FROM `wanted-data.wanted_ml_voc.voc_surge_score`
      WHERE recent_7d >= 5 ORDER BY recent_7d DESC LIMIT 8
    )
  GROUP BY week, category3
  ORDER BY week, category3
  ```
- x축: 주 (12주)
- y축: 티켓 수

### 3. 신규 키워드 (baseline 0 → 최근 등장)

- 타입: Table
- SQL:
  ```sql
  WITH prior AS (
    SELECT keyword, SUM(mentions) AS prior_mentions
    FROM `wanted-data.wanted_ml_voc.voc_keyword_trend`
    WHERE week_start < DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 2 WEEK)
    GROUP BY keyword
  ),
  recent AS (
    SELECT
      keyword,
      SUM(mentions) AS recent_mentions,
      SUM(negative_mentions) AS recent_negative,
      ANY_VALUE(top_category3) AS top_category3
    FROM `wanted-data.wanted_ml_voc.voc_keyword_trend`
    WHERE week_start >= DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 2 WEEK)
    GROUP BY keyword
  )
  SELECT
    r.keyword,
    r.recent_mentions,
    r.recent_negative,
    r.top_category3,
    COALESCE(p.prior_mentions, 0) AS prior_mentions
  FROM recent r
  LEFT JOIN prior p USING (keyword)
  WHERE COALESCE(p.prior_mentions, 0) < 2
    AND r.recent_mentions >= 3
  ORDER BY r.recent_mentions DESC
  LIMIT 30
  ```

### 4. 감정 트렌드 (area chart, stacked 100%)

- 타입: Area (100% stacked)
- x축: 주 (12주)
- y축: 감정별 비율 (positive/neutral/negative)
- SQL:
  ```sql
  SELECT
    DATE_TRUNC(date, WEEK(MONDAY)) AS week,
    emotion,
    SUM(tickets) AS tickets
  FROM `wanted-data.wanted_ml_voc.voc_daily`
  WHERE date >= DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 12 WEEK)
  GROUP BY week, emotion
  ORDER BY week
  ```

### 5. 반복 이슈 패턴 (같은 카테고리 4주 연속 이상)

- 타입: Table
- SQL:
  ```sql
  WITH weekly AS (
    SELECT
      DATE_TRUNC(date, WEEK(MONDAY)) AS week,
      category3,
      SUM(tickets) AS tickets
    FROM `wanted-data.wanted_ml_voc.voc_daily`
    WHERE date >= DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 8 WEEK)
    GROUP BY week, category3
  )
  SELECT
    category3,
    COUNT(DISTINCT week) AS weeks_active,
    SUM(tickets) AS total_tickets,
    AVG(tickets) AS avg_weekly
  FROM weekly
  WHERE tickets >= 5
  GROUP BY category3
  HAVING weeks_active >= 4
  ORDER BY total_tickets DESC
  LIMIT 20
  ```

### 6. 급증 카테고리 → 대표 티켓 drill-down

- 타입: 위젯 1 클릭 시 하위 파라미터 필터로 연결
- category3 filter → 아래 리스트에 반영
- SQL:
  ```sql
  SELECT
    id,
    event_create_time,
    category3,
    main_topic,
    title,
    SUBSTR(detail, 1, 300) AS detail_preview,
    overall_emotion,
    keywords
  FROM `wanted-data.wanted_ml.zendesk_voc_classified`
  WHERE DATE(event_create_time, 'Asia/Seoul') >= DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 7 DAY)
    AND category3 = {{category3}}  -- Metabase parameter
  ORDER BY event_create_time DESC
  LIMIT 20
  ```

## 레이아웃

```
┌───────────────────────────────┐
│ 급증 카테고리 top-10 (1)      │
├─────────────┬─────────────────┤
│ 카테고리    │ 신규 키워드 (3) │
│ 트렌드 (2)  │                 │
├─────────────┼─────────────────┤
│ 감정 트렌드 │ 반복 이슈 (5)   │
│ (4)         │                 │
├─────────────┴─────────────────┤
│ 대표 티켓 drill-down (6)      │
└───────────────────────────────┘
```

## 자동새로고침

1시간
