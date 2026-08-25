#!/usr/bin/env bash
# stamp_assets.sh — content-hash cache-busting for assets/*, no build step.
#
# Computes a short sha256 hash of assets/app.js and assets/site.css and
# rewrites the `?v=` query on every href/src referencing them across every
# HTML file in the repo. Idempotent (re-running with unchanged assets is a
# no-op).
#
# Usage:
#   ./stamp_assets.sh          write mode (default) — stamps the HTML files
#   ./stamp_assets.sh --check  check mode — verifies every reference already
#                               carries the current content hash; writes
#                               nothing; exits non-zero (with a diagnostic per
#                               drifted reference) if any is stale or missing
#
# Stamping must be the LAST step before committing an assets/* change — if
# you edit assets/app.js or assets/site.css again after running this script,
# the stamps go stale silently (the HTML still parses fine, still 200s, and
# looks stamped) while a returning visitor keeps serving the OLD cached JS
# against the NEW HTML — exactly the bug this script exists to prevent. Use
# `--check` as a pre-commit gate to catch that instead of re-discovering it
# in production (a tracked .githooks/pre-commit does this — see README.md).
#
# Matcher scope: a reference matches only when assets/app.js or
# assets/site.css appears at a path boundary in a quoted href/src value
# (string start, or immediately after a `/`) with at most a `?v=<lowercase
# hex>` query — e.g. "assets/app.js", "../assets/app.js",
# "assets/app.js?v=abc12345" all match; "https://cdn.example/x?u=assets/app.js"
# (the asset name isn't at a path boundary), "assets/app.js?foo=1&v=..." (an
# extra query param), and an existing "?v=" stamp in uppercase or non-hex all
# do NOT — such references are silently left unchanged by both modes.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_root"

mode="write"
case "${1:-}" in
  "") ;;
  --check) mode="check" ;;
  *)
    echo "usage: $0 [--check]" >&2
    exit 2
    ;;
esac

hash_of() { sha256sum "$1" | cut -c1-8; }

# Ordered so write-mode's summary output and check-mode's diagnostics are
# stable across runs. Each entry: "<asset repo-relative path>|<sed/grep
# ERE-escaped path>" — the single source of truth for which assets get
# stamped and how they're matched, shared by both write and check so they
# can't drift apart from each other.
ASSET_LIST=(
  "assets/app.js|assets/app\.js"
  "assets/site.css|assets/site\.css"
)

discover_html_files() {
  html_files=()
  while IFS= read -r -d '' f; do
    html_files+=("$f")
  done < <(find . -name '*.html' -not -path './.git/*' -not -path './data/*' -print0)
}

discover_html_files

declare -A asset_hash=()
for entry in "${ASSET_LIST[@]}"; do
  asset_path="${entry%%|*}"
  asset_hash["$asset_path"]="$(hash_of "$asset_path")"
done

# PREFIX_RE anchors the match to a path boundary: the asset name must sit at
# the start of the attribute value or immediately after a `/`, so a
# same-named asset embedded in an unrelated query string (see the matcher
# scope note above) can't false-positive-match. VER_RE is the version-query
# fragment. Both are shared verbatim by attr_ref_regex() below, used by BOTH
# the write (sed) and check (grep) paths, so "what counts as a stamp" can't
# diverge between the two.
PREFIX_RE='([^"]*/)?'
VER_RE='\?v=[0-9a-f]+'

# $1 = ERE-escaped asset path (e.g. assets/app\.js). Emits the exact ERE
# matching a possibly-already-stamped href/src reference to it: group 1 is
# (href|src), group 2 is the full prefix+asset-path (what a rewrite keeps),
# the rest is the optional existing ?v= stamp.
attr_ref_regex() {
  printf '(href|src)="(%s%s)(%s)?"' "$PREFIX_RE" "$1" "$VER_RE"
}

stamp_asset() {
  local asset_path="$1" pattern="$2" hash="$3"
  local regex
  regex="$(attr_ref_regex "$pattern")"
  for f in "${html_files[@]}"; do
    sed -E -i -e "s#${regex}#\1=\"\2?v=${hash}\"#g" "$f"
  done
}

# Prints one "STALE ..." line per drifted/missing reference to $asset_path
# found in $f and returns non-zero if any were found; silent + 0 if $f
# doesn't reference the asset at all, or every reference already matches.
check_asset_in_file() {
  local f="$1" asset_path="$2" pattern="$3" expected="$4"
  local regex drift=0
  local m ver
  regex="$(attr_ref_regex "$pattern")"
  while IFS= read -r m; do
    [ -z "$m" ] && continue
    ver="$(printf '%s' "$m" | grep -oE "$VER_RE" || true)"
    ver="${ver#\?v=}"
    if [ "$ver" != "$expected" ]; then
      echo "STALE  $f  references ${asset_path} with ?v=${ver:-<missing>} (expected ?v=${expected})"
      drift=1
    fi
  done < <(grep -oE "$regex" "$f" || true)
  return "$drift"
}

if [ "$mode" = "check" ]; then
  overall=0
  for entry in "${ASSET_LIST[@]}"; do
    asset_path="${entry%%|*}"
    pattern="${entry#*|}"
    for f in "${html_files[@]}"; do
      check_asset_in_file "$f" "$asset_path" "$pattern" "${asset_hash[$asset_path]}" || overall=1
    done
  done
  if [ "$overall" -eq 0 ]; then
    echo "OK — every asset reference is stamped with the current content hash."
    exit 0
  fi
  echo
  echo "Stale or missing ?v= stamp(s) — run ./stamp_assets.sh (no args) and re-stage before committing." >&2
  exit 1
fi

for entry in "${ASSET_LIST[@]}"; do
  asset_path="${entry%%|*}"
  pattern="${entry#*|}"
  stamp_asset "$asset_path" "$pattern" "${asset_hash[$asset_path]}"
done

for entry in "${ASSET_LIST[@]}"; do
  asset_path="${entry%%|*}"
  echo "${asset_path} -> ?v=${asset_hash[$asset_path]}"
done
printf 'stamped %d file(s):\n' "${#html_files[@]}"
printf '  %s\n' "${html_files[@]}"
