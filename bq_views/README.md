# BQ Views — wanted_ml_voc

VOC 대시보드/알람의 데이터 레이어. `wanted-data.wanted_ml.zendesk_voc_classified` 원천 위에 얹는 aggregation view 집합.

## View 목록

| View | 용도 | 소비자 |
|---|---|---|
| `voc_daily` | 일별·카테고리·감정별 집계 + 샘플 티켓 ID | Metabase CS Live 탭, Slack 일간 알람 |
| `voc_surge_score` | 최근 7일 vs 직전 28일 z-score/ratio + surge_level | Slack 알람 라우팅, Product Insights 탭 |
| `voc_keyword_trend` | 키워드(UNNEST) 주간 트렌드 | Product Insights 탭, 분석 에이전트 |

## 스캔량 관리

- 원천 테이블 파티션: `event_create_time` (필터 필수)
- `voc_daily`: 180일 롤링 (일 30~40MB × 180 ≈ 5GB scan on refresh)
- `voc_surge_score`: `voc_daily` 재사용 (수 MB)
- `voc_keyword_trend`: 90일 롤링 (약 3GB, UNNEST 확장)

Metabase가 자주 조회하므로 **`voc_daily`는 MATERIALIZED VIEW 후보**. 단, `ARRAY_AGG` 때문에 초안은 일반 VIEW로. 성능 이슈 발생하면 daily refresh scheduled query로 물리화.

## 적용

```bash
./apply.sh                # 모든 view CREATE OR REPLACE
./apply.sh --dry-run      # SQL만 출력, 실제 실행 안 함
./apply.sh voc_daily      # 단일 view만
```

`wanted_ml_voc` 데이터셋이 없으면 자동 생성 (location=`asia-northeast3` — 원천 `wanted_ml`과 동일 리전).

## 권한

- Metabase SA: `wanted_ml_voc.*` on `roles/bigquery.dataViewer` + `roles/bigquery.jobUser`
- 분석 에이전트 SA (Week 2+): 상동 + 원천 테이블 `wanted_ml.zendesk_voc_classified`

## DQ 주의사항

- **2026-05-25 주간**: `keywords` 분류율 78% (다른 주 95%+) → 그 주 baseline 소폭 저평가 가능성
- **동일 티켓 중복 삽입**: 06-28 결제 문의 케이스 확인됨 → `voc_daily`는 `ARRAY_AGG(DISTINCT id)` 대신 count 사용 (dedup 필요 시 별도 view 검토)
- **inbound_outbound·category 결측**: `COALESCE(_, '(미분류)')` 처리
