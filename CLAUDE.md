# CLAUDE.md

이 저장소는 AWS Lambda에서 동작하는 Slack 봇 애플리케이션입니다. Litestar + Slack Bolt 기반이며 Lambda Web Adapter를 사용해 단일 컨테이너 이미지로 여러 함수를 운영합니다.

## 아키텍처 요약
- **Web Function**: Function URL로 HTTP 요청 처리
- **Job Function**: EventBridge Scheduler로 예약 작업 실행
- **Slack Background Function**: 장시간 Slack 작업 비동기 처리
- 모든 함수가 동일한 이미지(단일 Docker 이미지)를 공유하고 `AWS_LWA_PASS_THROUGH_PATH`로 라우팅됩니다.

## 핵심 경로
- `src/voc_monitoring/app.py`: Litestar 앱 엔트리
- `src/voc_monitoring/slack/`: Slack Bolt 앱, 핸들러, 백그라운드 처리
- `src/voc_monitoring/jobs/runner.py`: 예약 작업 로직
- `template.yaml`: CloudFormation 스택 정의
- `scripts/`: 배포/운영 스크립트 (`create_roles.sh`, `deploy_stack.sh`, `sync_env.py` 등)
- `justfile`: 개발/배포 커맨드 모음

## 코딩 가이드 (Litestar)
- 라우트 핸들러는 기본적으로 `async`로 작성합니다.
- 동기 핸들러가 필요하면 `sync_to_thread`를 명시해 thread pool 실행 여부를 선언합니다.
- `boto3`, `slack_sdk`처럼 동기 I/O 라이브러리는 `anyio.to_thread.run_sync`로 오프로딩합니다.

## Slack 롱러닝 처리 (Lambda + LWA)
- Slack 요청은 3초 내 2xx/ack 응답이 원칙입니다. 이벤트는 빠르게 200 응답 후 실제 처리를 분리합니다.
- 이 템플릿은 WebFunction이 수신 후 `SlackBgFunction`으로 작업을 위임하는 흐름을 기본으로 합니다.
- 후속 응답은 `response_url` 또는 Slack Web API(`chat.postMessage`)로 전송합니다.
- FaaS 환경에서 `process_before_response=True`를 사용하는 경우, 리스너는 3초 내 종료되어야 하므로 장시간 작업은 반드시 분리합니다.

## 자주 쓰는 커맨드
```bash
uv sync --frozen
just serve
just build
just deploy
just url
just create-roles
just sync-env
```

```bash
just invoke-job
```


## 환경 변수
- `dot_env.example`을 복사해 `.env`를 만들고 값을 채웁니다.
- 새 Lambda 환경변수는 `.env`에 `LAMBDA_` prefix로 추가한 뒤 `just sync-env`로 동기화합니다.
- 별도 AWS 프로파일이 필요하면 `AWS_PROFILE=프로파일명 <command>` 형태로 실행합니다.

## 테스트/품질
```bash
uv run ruff check .
uv run ruff format .
uv run mypy src/
uv run pytest
```

## 문서
- `docs/SLACK_GUIDE.md`: 메시지 포맷, 실패 대응, 트러블슈팅
