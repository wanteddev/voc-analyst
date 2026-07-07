-- voc_actions — Jira 이슈로 등록된 액션과 성과(전/후 티켓 발생률) 트래킹
-- 웹앱 /api/jira/create가 이슈 생성 시 INSERT하고,
-- scripts/backfill-action-effects.py가 Jira status=Done 감지 후 resolved_at + post_resolution_rate 갱신.

CREATE TABLE IF NOT EXISTS `wanted-data.wanted_ml_voc.voc_actions` (
  action_id STRING NOT NULL,               -- Jira issue key (예: LIVE-1234) 재사용
  category3 STRING NOT NULL,               -- 카테고리 (voc_surge_score의 category3)
  category2 STRING,
  category1 STRING,
  jira_key STRING NOT NULL,
  jira_url STRING,
  created_by STRING,                       -- 생성자 이메일
  created_at TIMESTAMP NOT NULL,
  resolved_at TIMESTAMP,                   -- Jira Done 전환 시점 (backfill)
  baseline_ticket_rate FLOAT64,            -- 이슈 생성 시점 recent_daily_avg
  post_resolution_ticket_rate FLOAT64,     -- 해결 4주 후 recent_daily_avg
  effect_pct FLOAT64,                      -- (post - baseline) / baseline * 100
  effect_label STRING,                     -- '개선' | '악화' | '변화없음' | 'pending'
  notes STRING
)
PARTITION BY DATE(created_at)
CLUSTER BY category3;

-- 요약 view — Executive KPI용
CREATE OR REPLACE VIEW `wanted-data.wanted_ml_voc.voc_actions_summary` AS
SELECT
  COUNT(*) AS total_actions,
  COUNTIF(resolved_at IS NOT NULL) AS resolved_actions,
  COUNTIF(effect_label = '개선') AS improved_actions,
  COUNTIF(effect_label = '악화') AS worsened_actions,
  AVG(effect_pct) AS avg_effect_pct
FROM `wanted-data.wanted_ml_voc.voc_actions`
WHERE created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY);
