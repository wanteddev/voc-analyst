# Backyard 배포용 arm64 Dockerfile (amd64 push 시 exec format error)

FROM --platform=linux/arm64 python:3.13-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1

# uv 설치 (빠른 의존성 해결)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

# 시스템 패키지 (curl은 healthcheck, ca-certificates는 gRPC/BQ)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# 의존성 선반영 (lockfile 기반 재현 빌드)
# README.md는 pyproject.toml [project].readme 참조로 uv 빌드 시 필요
COPY pyproject.toml uv.lock requirements.lock README.md ./
RUN uv sync --frozen --no-install-project

# 소스 복사
COPY src/ ./src/
# 프로젝트 자체 install (편집 가능)
RUN uv sync --frozen

# non-root 유저 (Claude CLI 등이 root 거부하는 케이스 대응 — 메모리 claude_cli_nonroot.md 참고)
RUN useradd -m -u 1000 bot && chown -R bot:bot /app
USER bot

EXPOSE 8080

# healthcheck (Litestar /healthz)
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:8080/healthz || exit 1

# scheduler + web server 동거 실행
CMD ["uv", "run", "--frozen", "uvicorn", "voc_analyst.app:app", "--host", "0.0.0.0", "--port", "8080"]
