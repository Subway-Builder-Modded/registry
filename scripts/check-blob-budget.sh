#!/usr/bin/env bash
#
# Fail a change that re-introduces relocated/raster blobs or exceeds the size budget.
#
# Budget is empirical, from the post-WebP / post-relocation tip:
#   - non-history legit max = 1.77 MB (gallery preview.webp); everything else < 0.6 MB
#   - the gallery PNGs we purged were 4-7.3 MB
# So the cap sits in the 1.77 -> 4 MB gap. history/ is exempt from the size cap:
# append-only analytics, compresses ~14x (~0.9 MB packed total), read monolithically.
#
# Usage: check-blob-budget.sh <base-ref> [head-ref]   (checks added/modified files in the range)
set -euo pipefail

BASE_REF="${1:?usage: check-blob-budget.sh <base-ref> [head-ref]}"
HEAD_REF="${2:-HEAD}"

SIZE_CAP=$((5 * 512 * 1024))   # 2.5 MiB — > 1.77 MB WebP max, < 4 MB raster range
RASTER_RE='\.(png|jpe?g|bmp|tiff?|gif)$'

fail=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  [ -f "$f" ] || continue

  # Relocated artifacts live on the map-data branch, never on main.
  case "$f" in
    maps/*/grid.geojson|maps/*/basemap.svg)
      echo "BLOCK  $f — relocated to the map-data branch; do not commit on main."
      fail=1; continue;;
  esac

  # Galleries are WebP; rasters are not allowed anywhere.
  if [[ "$f" =~ $RASTER_RE ]]; then
    echo "BLOCK  $f — raster image; convert to .webp."
    fail=1; continue
  fi

  # Size budget. history/ is exempt (append-only analytics, ~0.9 MB packed total).
  case "$f" in history/*) continue;; esac
  size=$(wc -c <"$f")
  if [ "$size" -gt "$SIZE_CAP" ]; then
    awk -v f="$f" -v s="$size" -v c="$SIZE_CAP" \
      'BEGIN{printf "BLOCK  %s — %.2f MB exceeds %.2f MB budget.\n", f, s/1048576, c/1048576}'
    fail=1
  fi
done < <(git diff --name-only --diff-filter=AM "${BASE_REF}...${HEAD_REF}")

if [ "$fail" -ne 0 ]; then
  echo "Blob budget check failed — see BLOCK lines above."
  exit 1
fi
echo "Blob budget check passed."
