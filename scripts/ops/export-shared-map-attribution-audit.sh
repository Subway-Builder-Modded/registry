#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SNAPSHOT_DATE="${1:-2026_03_30}"
OUT_DIR="${REPO_ROOT}/tmp/shared-map-attribution-audit"

mkdir -p "${OUT_DIR}/registry" "${OUT_DIR}/jp-repo" "${OUT_DIR}/actions"

cp "${REPO_ROOT}/maps/integrity.json" "${OUT_DIR}/registry/maps.integrity.json"
cp "${REPO_ROOT}/history/registry-download-attribution.json" "${OUT_DIR}/registry/registry-download-attribution.json"
cp "${REPO_ROOT}/history/snapshot_${SNAPSHOT_DATE}.json" "${OUT_DIR}/registry/snapshot_${SNAPSHOT_DATE}.json"

gh api repos/ahkimn/subwaybuilder-jp-maps/releases?per_page=100 \
  > "${OUT_DIR}/jp-repo/releases.json"

for tag in 0.2.0 0.3.0 0.3.1 0.3.2; do
  gh api "repos/ahkimn/subwaybuilder-jp-maps/releases/tags/${tag}" \
    > "${OUT_DIR}/jp-repo/release_${tag}.json"
done

for code in ITM NGO NGS OKJ; do
  curl -L "https://ahkimn.github.io/subwaybuilder-jp-maps/${code}.json" \
    > "${OUT_DIR}/jp-repo/${code}.update.json"
done

LATEST_HOURLY_RUN_ID="$(gh run list --workflow regenerate-downloads-hourly.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
LATEST_CACHE_RUN_ID="$(gh run list --workflow cache-download-history.yml --limit 1 --json databaseId --jq '.[0].databaseId')"

gh run view "${LATEST_HOURLY_RUN_ID}" --log > "${OUT_DIR}/actions/regenerate-downloads-hourly_latest.log"
gh run view "${LATEST_CACHE_RUN_ID}" --log > "${OUT_DIR}/actions/cache-download-history_latest.log"

echo "[export-shared-map-attribution-audit] wrote audit bundle to ${OUT_DIR}"
