# Metabase — VOC Dashboard

Backyard `prj-voc-dashboard` 프로젝트에 Metabase 컨테이너로 배포.

## 파일

- `Dockerfile` — arm64 metabase/metabase:latest 래핑
- `backyard-spec.md` — Backyard 프로젝트 생성 파라미터, BQ SA 준비, 배포 순서

## Quick start

```bash
# 1. BQ SA 준비 (backyard-spec.md의 스크립트)
# 2. Backyard 프로젝트 생성 (MCP: create_project)
# 3. 이미지 push
docker buildx build --platform=linux/arm64 \
  -t lab.wntd.co/proj-XXXXXX/backend:latest --push metabase/
# 4. Backyard MCP: upsert_secret으로 bq-sa.json 업로드
# 5. Metabase 웹 UI 접속 → 관리자 세팅 → BQ 연결
```

## 대시보드 정의

`../dashboards/*.md` 참고 (다음 단계 D3에서 작성).
