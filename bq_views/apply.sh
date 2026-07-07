#!/usr/bin/env bash
# Apply BQ views to wanted-data.wanted_ml_voc
# Usage:
#   ./apply.sh                # apply all
#   ./apply.sh --dry-run      # print SQL only
#   ./apply.sh voc_daily      # apply single view (matches *voc_daily.sql)

set -euo pipefail

PROJECT="wanted-data"
DATASET="wanted_ml_voc"
LOCATION="asia-northeast3"  # 원천 wanted_ml과 동일 리전 (Seoul). 크로스리전 조회 불가하므로 반드시 일치.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DRY_RUN=false
TARGET_MATCH="*"

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) TARGET_MATCH="*${arg}*.sql" ;;
  esac
done

log() { printf '\033[36m[apply]\033[0m %s\n' "$*"; }
err() { printf '\033[31m[apply:err]\033[0m %s\n' "$*" >&2; }

# 1. Ensure dataset exists
if ! bq --project_id="$PROJECT" show --dataset "$DATASET" >/dev/null 2>&1; then
  log "Dataset $PROJECT:$DATASET not found — creating (location=$LOCATION)"
  if [[ "$DRY_RUN" == "true" ]]; then
    log "[dry-run] bq mk --dataset --location=$LOCATION --description='VOC dashboard views' $PROJECT:$DATASET"
  else
    bq mk --dataset --location="$LOCATION" \
      --description="VOC dashboard aggregation views (source: wanted_ml.zendesk_voc_classified)" \
      "$PROJECT:$DATASET"
  fi
else
  log "Dataset $PROJECT:$DATASET already exists"
fi

# 2. Apply view SQL files in filename order (01_, 02_, ...)
shopt -s nullglob
found_any=false
for sql_file in "$SCRIPT_DIR"/$TARGET_MATCH; do
  [[ "$(basename "$sql_file")" == "apply.sh" ]] && continue
  [[ "$sql_file" != *.sql ]] && continue
  found_any=true
  log "Applying $(basename "$sql_file")"
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "----- $(basename "$sql_file") -----"
    cat "$sql_file"
    echo "-----"
  else
    bq query --use_legacy_sql=false \
      --maximum_bytes_billed=53687091200 \
      --project_id="$PROJECT" \
      < "$sql_file"
  fi
done

if [[ "$found_any" == "false" ]]; then
  err "No SQL files matched: $TARGET_MATCH"
  exit 1
fi

log "Done."
