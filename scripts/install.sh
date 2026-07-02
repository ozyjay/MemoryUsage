#!/usr/bin/env bash
set -euo pipefail

uuid="memory-usage-widget@local"
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target_dir="${HOME}/.local/share/gnome-shell/extensions/${uuid}"

mkdir -p "${target_dir}"
install -m 0644 "${source_dir}/metadata.json" "${target_dir}/metadata.json"
install -m 0644 "${source_dir}/extension.js" "${target_dir}/extension.js"
install -m 0644 "${source_dir}/stylesheet.css" "${target_dir}/stylesheet.css"

echo "Installed ${uuid} to ${target_dir}"
echo "Enable it with: gnome-extensions enable ${uuid}"
