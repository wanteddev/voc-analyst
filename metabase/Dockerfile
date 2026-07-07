# Metabase arm64 image for Backyard deployment
# 공식 metabase/metabase 이미지는 multi-arch (linux/amd64, linux/arm64) 지원.
# Backyard 런타임이 arm64이므로 --platform=linux/arm64 명시로 잘못된 아키텍처 push 방지.
# 참고: wanted-insights-bot 메모리 backyard_arm64.md — amd64 이미지 push 시 exec format error.

FROM --platform=linux/arm64 metabase/metabase:latest

# BQ 접근용 SA JSON은 Backyard secret으로 마운트 (환경변수 GOOGLE_APPLICATION_CREDENTIALS
# 는 시크릿이 마운트된 경로를 가리키도록 backyard 매니페스트에서 설정).

# Metabase 자체 설정은 metadata Postgres에 저장되므로 여기서 별도 세팅 불필요.
# Backyard managed Postgres 연결 파라미터는 backyard-spec.md 참조.

# health check용 endpoint는 /api/health (Metabase 기본)
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

EXPOSE 3000
