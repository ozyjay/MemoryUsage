#!/usr/bin/env bash
set -euo pipefail

uuid="memory-usage-widget@local"
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target_dir="${HOME}/.local/share/gnome-shell/extensions/${uuid}"
pack_dir="${TMPDIR:-/tmp}/memory-usage-widget-test"

if command -v jq >/dev/null 2>&1; then
  jq empty "${source_dir}/metadata.json"
else
  python3 -m json.tool "${source_dir}/metadata.json" >/dev/null
fi

rm -rf "${pack_dir}"
mkdir -p "${pack_dir}"
gnome-extensions pack --force --out-dir "${pack_dir}" "${source_dir}" >/dev/null

if [[ -d "${target_dir}" ]]; then
  gnome-extensions info "${uuid}" >/dev/null
else
  echo "Skipping gnome-extensions info: ${uuid} is not installed yet."
fi

echo "Validation passed."
