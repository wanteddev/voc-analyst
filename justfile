set shell := ["bash", "-lc"]

webapp_image := env('WEBAPP_IMAGE', 'lab.wntd.co/proj-a2qqw2/frontend:latest')

[doc("Show available recipes")]
default:
  @just --list --unsorted --justfile {{justfile()}}

[doc("Run Next.js dev server locally")]
dev:
  cd webapp && npm run dev

[doc("Typecheck + production build (배포 전 확인)")]
check:
  cd webapp && npm run typecheck && npm run build

[doc("Build & push dashboard image to Backyard (arm64)")]
deploy:
  docker buildx build --platform=linux/arm64 --no-cache -t {{webapp_image}} --push webapp
