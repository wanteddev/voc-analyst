# Executive 대시보드

**타겟**: 리더십
**목적**: MoM/QoQ VOC 트렌드 확인, 카테고리 파레토, 액션-성과 연결

## 위젯

### 1. 이번 달 VOC 총량 (스카칼)

- 타입: Number
- SQL:
  ```sql
  SELECT SUM(tickets)
  FROM `wanted-data.wanted_ml_voc.voc_daily`
  WHERE date >= DATE_TRUNC(CURRENT_DATE('Asia/Seoul'), MONTH)
  ```
- 부제: MoM % (Metabase built-in)

### 2. 이번 달 부정 감정 비율 (게이지)

- 타입: Gauge
- SQL:
  ```sql
  SELECT
    SAFE_DIVIDE(SUM(negative_tickets), SUM(tickets)) AS negative_ratio
  FROM `wanted-data.wanted_ml_voc.voc_daily`
  WHERE date >= DATE_TRUNC(CURRENT_DATE('Asia/Seoul'), MONTH)
  ```
- 범위: 0-1, 임계값 0.3 (yellow), 0.5 (red)

### 3. 최근 6개월 VOC 볼륨 (bar chart)

- 타입: Bar (grouped by emotion)
- SQL:
  ```sql
  SELECT
    DATE_TRUNC(date, MONTH) AS month,
    emotion,
    SUM(tickets) AS tickets
  FROM `wanted-data.wanted_ml_voc.voc_daily`
  WHERE date >= DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 6 MONTH)
  GROUP BY month, emotion
  ORDER BY month
  ```

### 4. 카테고리 파레토 (top 5 category3 = 티켓의 몇 %?)

- 타입: Bar + Line combo (bar=티켓수, line=누적 %)
- SQL:
  ```sql
  WITH agg AS (
    SELECT category3, SUM(tickets) AS tickets
    FROM `wanted-data.wanted_ml_voc.voc_daily`
    WHERE date >= DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 30 DAY)
    GROUP BY category3
    ORDER BY tickets DESC
    LIMIT 15
  )
  SELECT
    category3,
    tickets,
    SUM(tickets) OVER (ORDER BY tickets DESC ROWS UNBOUNDED PRECEDING) AS cumulative,
    SUM(tickets) OVER () AS total,
    ROUND(SUM(tickets) OVER (ORDER BY tickets DESC ROWS UNBOUNDED PRECEDING)
          / SUM(tickets) OVER () * 100, 1) AS cumulative_pct
  FROM agg
  ORDER BY tickets DESC
  ```

### 5. 액션 → 성과 트래킹 (Week 2+에 활성화)

- 타입: Table
- Source: `wanted_ml_voc.voc_actions` (Week 2 신설 예정 — Jira LIVE 이슈 라벨링 기반)
- SQL (신설 후):
  ```sql
  SELECT
    a.action_id,
    a.jira_key,
    a.category3,
    a.created_at,
    a.resolved_at,
    a.baseline_ticket_rate,
    a.post_resolution_ticket_rate,
    ROUND((a.post_resolution_ticket_rate - a.baseline_ticket_rate)
          / a.baseline_ticket_rate * 100, 1) AS effect_pct,
    CASE
      WHEN a.post_resolution_ticket_rate < a.baseline_ticket_rate * 0.7 THEN '개선'
      WHEN a.post_resolution_ticket_rate > a.baseline_ticket_rate * 1.2 THEN '악화'
      ELSE '변화없음'
    END AS effect_label
  FROM `wanted-data.wanted_ml_voc.voc_actions` a
  WHERE a.resolved_at IS NOT NULL
  ORDER BY a.resolved_at DESC
  LIMIT 30
  ```
- Week 1에는 "Week 2에 활성화" 안내 placeholder 표시

### 6. 감정 지수 트렌드 (line)

- 타입: Line
- SQL:
  ```sql
  SELECT
    DATE_TRUNC(date, WEEK(MONDAY)) AS week,
    ROUND(
      SAFE_DIVIDE(
        SUM(positive_tickets) - SUM(negative_tickets),
        SUM(tickets)
      ), 3
    ) AS sentiment_score
  FROM `wanted-data.wanted_ml_voc.voc_daily`
  WHERE date >= DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 12 WEEK)
  GROUP BY week
  ORDER BY week
  ```
- y축 범위: -1 ~ +1

## 레이아웃

```
┌───────────┬───────────────────┐
│ 이번 달   │ 이번 달 부정 (2)   │
│ VOC (1)   │                    │
├───────────┴───────────────────┤
│ 최근 6개월 VOC 볼륨 (3)       │
├───────────────────────────────┤
│ 카테고리 파레토 (4)           │
├───────────────────────────────┤
│ 감정 지수 트렌드 (6)          │
├───────────────────────────────┤
│ 액션 → 성과 (5) [Week 2 활성] │
└───────────────────────────────┘
```

## 자동새로고침

6시간 (임원용은 잦은 refresh 불필요)
