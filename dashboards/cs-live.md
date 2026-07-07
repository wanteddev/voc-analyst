# CS Live 대시보드

**타겟**: CS팀 (VOC 대응 담당자)
**목적**: 오늘 들어온 티켓 트리아지, 부정 감정 우선순위, 개별 티켓 드릴다운

## 위젯

### 1. 오늘 신규 티켓 (스카칼 카드)

- 타입: Number
- SQL:
  ```sql
  SELECT SUM(tickets)
  FROM `wanted-data.wanted_ml_voc.voc_daily`
  WHERE date = CURRENT_DATE('Asia/Seoul')
  ```
- 부제: 전일 대비 % (Metabase built-in comparison)

### 2. 오늘 부정 감정 티켓 (스카칼 카드)

- 타입: Number (빨간색 accent)
- SQL:
  ```sql
  SELECT SUM(negative_tickets)
  FROM `wanted-data.wanted_ml_voc.voc_daily`
  WHERE date = CURRENT_DATE('Asia/Seoul')
  ```

### 3. 최근 7일 카테고리별 티켓 heatmap

- 타입: Pivot table (row = category2/category3, col = date, value = tickets)
- SQL:
  ```sql
  SELECT date, category2, category3, SUM(tickets) AS tickets
  FROM `wanted-data.wanted_ml_voc.voc_daily`
  WHERE date >= DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 7 DAY)
  GROUP BY date, category2, category3
  ```
- 조건부 색상: tickets 값에 따라 gradient

### 4. 오늘 부정 티켓 상세 리스트

- 타입: Table
- SQL:
  ```sql
  SELECT
    z.id AS ticket_id,
    z.event_create_time AS created_at,
    z.company_name,
    z.category3,
    z.main_topic,
    z.title,
    SUBSTR(z.detail, 1, 200) AS detail_preview,
    -- Zendesk 링크 (실제 URL 패턴 확인 필요)
    CONCAT('https://wantedlab.zendesk.com/agent/tickets/', z.id) AS zendesk_url
  FROM `wanted-data.wanted_ml.zendesk_voc_classified` z
  WHERE DATE(z.event_create_time, 'Asia/Seoul') = CURRENT_DATE('Asia/Seoul')
    AND z.overall_emotion = '부정'
  ORDER BY z.event_create_time DESC
  ```
- click behavior: ticket_id 클릭 → zendesk_url로 이동

### 5. 카테고리 처리 상황 (막대차트)

- 타입: Bar
- x축: category3 (top 10 by tickets)
- y축: 최근 7일 tickets (stacked by emotion)
- SQL:
  ```sql
  SELECT category3, emotion, SUM(tickets) AS tickets
  FROM `wanted-data.wanted_ml_voc.voc_daily`
  WHERE date >= DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 7 DAY)
  GROUP BY category3, emotion
  ORDER BY tickets DESC
  LIMIT 30
  ```

## 레이아웃

```
┌───────────────┬───────────────┐
│ 오늘 신규(1)   │ 오늘 부정(2)   │
├───────────────┴───────────────┤
│ 최근 7일 heatmap (3)          │
├───────────────────────────────┤
│ 오늘 부정 티켓 리스트 (4)     │
├───────────────────────────────┤
│ 카테고리 처리 상황 (5)         │
└───────────────────────────────┘
```

## 자동새로고침

10분 (실시간에 가깝게)
