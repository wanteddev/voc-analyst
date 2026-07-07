# Backyard 프로젝트 스펙 — prj-voc-dashboard

Metabase self-hosted 대시보드 배포.

## 프로젝트 파라미터

| 필드 | 값 |
|---|---|
| `displayName` | `voc-dashboard` |
| `description` | VOC 대시보드 (Metabase) — wanted_ml_voc.* 뷰 시각화. CS/Product/Executive 3개 뷰. Slack `#prj-voc-dashboard` 알람 연동. |
| `visibility` | `protected` (사내 SSO) |
| `privateDomain.prefix` | `voc-dashboard` → `prj-frontend-<hash>.lab.wntd.co` |
| `backend.enabled` | `true` |
| `backend.image` | `lab.wntd.co/prj-<hash>/backend:latest` (Metabase Dockerfile 빌드 결과 push) |
| `database.enabled` | `true` |
| `database.engine` | `postgresql` |
| `database.databaseName` | `metabase` |
| `database.username` | `metabase` |
| `database.password` | (Backyard 자동 생성) |
| `database.storageSizeGB` | `10` (초기; 대시보드 정의·유저·쿼리 히스토리) |
| `autoDelete.duration` | `1month` (연장 요청) |

## Metabase 환경변수 (Backyard secret + env)

Metabase는 `MB_*` env로 설정:

```
MB_DB_TYPE=postgres
MB_DB_HOST=<backyard managed postgres host>
MB_DB_PORT=5432
MB_DB_DBNAME=metabase
MB_DB_USER=metabase
MB_DB_PASS=<secret>
MB_JETTY_HOST=0.0.0.0
MB_JETTY_PORT=3000
MB_SITE_URL=https://prj-frontend-<hash>.lab.wntd.co
MB_ENCRYPTION_SECRET_KEY=<32+ char random>  # 시크릿 필드 암호화
```

BQ 접근용:

```
GOOGLE_APPLICATION_CREDENTIALS=/secrets/bq-sa.json
```

Backyard secret으로 아래 파일 마운트:
- `/secrets/bq-sa.json` — BigQuery SA JSON (권한: `wanted_ml_voc.*` 읽기 + `bigquery.jobUser`)

## BQ Service Account 준비

```bash
# 1. SA 생성
gcloud iam service-accounts create voc-dashboard-metabase \
  --project=wanted-data \
  --display-name="VOC Dashboard Metabase"

# 2. 권한 부여 (wanted_ml_voc.* readonly + job execute)
bq add-iam-policy-binding \
  --member="serviceAccount:voc-dashboard-metabase@wanted-data.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataViewer" \
  wanted-data:wanted_ml_voc

gcloud projects add-iam-policy-binding wanted-data \
  --member="serviceAccount:voc-dashboard-metabase@wanted-data.iam.gserviceaccount.com" \
  --role="roles/bigquery.jobUser"

# 3. JSON 키 생성 → Backyard secret으로 업로드
gcloud iam service-accounts keys create bq-sa.json \
  --iam-account=voc-dashboard-metabase@wanted-data.iam.gserviceaccount.com
```

## 배포 순서

1. **Backyard 프로젝트 생성** (`mcp__backyard__create_project`)
   - 위 파라미터로 생성 → project ID (`proj-XXXXXX`) 반환됨
2. **이미지 빌드 & push**
   ```bash
   cd metabase
   docker buildx build --platform=linux/arm64 \
     -t lab.wntd.co/proj-XXXXXX/backend:latest --push .
   ```
3. **BQ SA JSON 시크릿 업로드** (`mcp__backyard__upsert_secret`)
   - key: `bq-sa.json` (파일 마운트)
   - value: 위 SA 키 JSON 내용
4. **Backyard 프로젝트 status가 Running이 될 때까지 대기**
5. **Metabase 초기 세팅** (웹 UI)
   - 관리자 계정 생성 (jiyoon.you@wantedlab.com)
   - BigQuery 데이터베이스 추가 → SA JSON 파일 경로 지정 (`/secrets/bq-sa.json`)
   - `wanted_ml_voc.voc_daily`, `voc_surge_score`, `voc_keyword_trend` view 3개 sync
6. **대시보드 3개 생성** — `../dashboards/*.md` 스펙 참고

## 이후 이관 (선택)

Metabase 대시보드 정의는 metadata Postgres에 저장. 이관/백업 위해 [metabase-serialization](https://www.metabase.com/docs/latest/installation-and-operation/serialization) YAML export/import 활용 가능.
