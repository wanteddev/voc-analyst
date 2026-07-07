-- voc_daily — 일별·카테고리·감정별 VOC 티켓 집계
-- Source: wanted-data.wanted_ml.zendesk_voc_classified
-- Consumer: Metabase CS Live 탭, Slack 일간 알람, voc_surge_score 상위 view
-- Refresh: on-demand (VIEW). 성능 이슈 시 daily scheduled query로 MATERIALIZED VIEW화

CREATE OR REPLACE VIEW `wanted-data.wanted_ml_voc.voc_daily` AS
SELECT
  DATE(event_create_time, 'Asia/Seoul') AS date,
  COALESCE(category1, '(미분류)') AS category1,
  COALESCE(category2, '(미분류)') AS category2,
  COALESCE(category3, '(미분류)') AS category3,
  COALESCE(overall_emotion, '(미분류)') AS emotion,
  COALESCE(inbound_outbound, '(미분류)') AS direction,
  COUNT(*) AS tickets,
  COUNTIF(overall_emotion = '부정') AS negative_tickets,
  COUNTIF(overall_emotion = '긍정') AS positive_tickets,
  COUNTIF(overall_emotion = '중립') AS neutral_tickets,
  ARRAY_AGG(id ORDER BY event_create_time DESC LIMIT 30) AS sample_ids
FROM `wanted-data.wanted_ml.zendesk_voc_classified`
-- 롤링: 180일 (성능·비용 최적). TVF `voc_surge_score_at`은 이 view 위에서 계산되므로
-- 실용 asOf 범위는 최근 ~5개월. 그 이상 뒤로 가려면 이 값 상향 or 별도 파티션 테이블화.
WHERE event_create_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 180 DAY)
GROUP BY date, category1, category2, category3, emotion, direction;
