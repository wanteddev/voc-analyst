set shell := ["bash", "-lc"]

# Backyard 배포 기준. (구 AWS Lambda/CloudFormation 레시피는 제거됨 — git history 참고)
bot_image := env('BOT_IMAGE', 'lab.wntd.co/proj-d2ezv3/backend:latest')
webapp_image := env('WEBAPP_IMAGE', 'lab.wntd.co/proj-a2qqw2/frontend:latest')
uv := env('UV', 'uv')

[doc("Show available recipes")]
default:
  @just --list --unsorted --justfile {{justfile()}}

[doc("Update dependency lockfile with uv")]
lock:
  {{uv}} lock
  cp uv.lock requirements.lock

[doc("Run Litestar dev server locally")]
serve:
  {{uv}} run litestar --app voc_analyst.app:app run --host 0.0.0.0 --port 8080

[doc("Build & push Slack bot image to Backyard (arm64)")]
build-bot:
  docker buildx build --platform=linux/arm64 --no-cache -t {{bot_image}} --push .

[doc("Build & push dashboard webapp image to Backyard (arm64)")]
build-webapp:
  docker buildx build --platform=linux/arm64 --no-cache -t {{webapp_image}} --push webapp
