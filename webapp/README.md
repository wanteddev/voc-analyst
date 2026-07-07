# voc-dashboard webapp

Next.js 14 App Router + BigQuery (via @google-cloud/bigquery) 대시보드.
Backyard `proj-a2qqw2`에 배포됨.

## 페이지

- `/cs` — CS Live (오늘 대응): 부정 티켓 리스트 · 급증 카테고리 요약
- `/product` — Product Insights: 급증 상세 + 12주 트렌드 + 신규 키워드
- `/executive` — Executive: MoM 볼륨, 감정, 파레토

## 로컬 개발

```bash
cd webapp
npm install
export GCP_SA_KEY="$(cat ~/voc-bq-sa.json)"
export BQ_PROJECT=wanted-data
npm run dev
```

## 배포

```bash
docker buildx build --platform=linux/arm64 \
  -t lab.wntd.co/proj-a2qqw2/backend:latest --push .
# → Backyard proj-a2qqw2 backend restart
```

## 데이터 소스

- `wanted-data.wanted_ml_voc.voc_surge_score`
- `wanted-data.wanted_ml_voc.voc_daily`
- `wanted-data.wanted_ml_voc.voc_keyword_trend`
- `wanted-data.wanted_ml.zendesk_voc_classified` (drill-down)

## 인증

`GCP_SA_KEY` 시크릿(Backyard) → `instrumentation.ts`에서 `/tmp/voc-sa.json`으로 마운트 → `GOOGLE_APPLICATION_CREDENTIALS` 자동 세팅.
