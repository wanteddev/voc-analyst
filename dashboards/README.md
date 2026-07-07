# Metabase 대시보드 스펙

3개 뷰 (CS Live / Product Insights / Executive) — 타겟 유저별로 분리.

## 데이터 소스

- Metabase 데이터베이스: `wanted-data` (BigQuery, SA `voc-dashboard-metabase`)
- 사용 view: `wanted_ml_voc.voc_daily`, `voc_surge_score`, `voc_keyword_trend`
- 원천 참조 (필요 시): `wanted_ml.zendesk_voc_classified` (drill-down용)

## 세팅 순서

1. Metabase 관리자 → Admin → Databases → BigQuery 추가
   - Project: `wanted-data`
   - SA JSON: `/secrets/bq-sa.json`
   - Datasets: `wanted_ml_voc`, `wanted_ml` (drill-down용)
2. 좌측 Collections → "VOC Dashboard" 폴더 신설
3. 아래 각 md의 위젯을 하나씩 Question(질문)으로 생성 → 대시보드에 배치
4. 대시보드 하나당 자동새로고침 5분 설정

## 위젯 스펙 파일

- [`cs-live.md`](cs-live.md) — CS팀 오늘 대응 대시보드
- [`product-insights.md`](product-insights.md) — PM/기획팀 프로덕트 이슈 발굴 대시보드
- [`executive.md`](executive.md) — 리더십 KPI 대시보드

## 공통 필터

각 대시보드에 아래 필터 3개를 dashboard-level parameter로 배치:
- 기간 (기본: 최근 30일)
- category1 (유저/기업/기타, multi-select)
- 감정 (긍정/중립/부정, multi-select)
