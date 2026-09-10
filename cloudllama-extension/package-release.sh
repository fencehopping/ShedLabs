#!/usr/bin/env bash
set -euo pipefail

extension_root="$(cd "$(dirname "$0")" && pwd)"
release_dir="${1:-$extension_root/releases}"
extension_version="$(node -e 'const manifest=require(process.argv[1]); process.stdout.write(manifest.version)' "$extension_root/manifest.json")"
archive_path="$release_dir/cloud-llama-$extension_version.zip"
release_stage="$(mktemp -d)"

cleanup_release_stage() {
  rm -rf "$release_stage"
}
trap cleanup_release_stage EXIT

mkdir -p "$release_dir"
cp "$extension_root/manifest.json" "$release_stage/"
cp "$extension_root/background.js" "$release_stage/"
cp "$extension_root/offscreen.html" "$release_stage/"
cp "$extension_root/offscreen.js" "$release_stage/"
cp "$extension_root/player.html" "$release_stage/"
cp "$extension_root/player.js" "$release_stage/"
cp "$extension_root/styles.css" "$release_stage/"
mkdir -p "$release_stage/assets/figma" "$release_stage/vendor"
cp "$extension_root/assets/cloud-llama.png" "$release_stage/assets/"
cp "$extension_root/assets/soundcloud-logo-white.png" "$release_stage/assets/"
cp "$extension_root/assets/icon16.png" "$release_stage/assets/"
cp "$extension_root/assets/icon32.png" "$release_stage/assets/"
cp "$extension_root/assets/icon48.png" "$release_stage/assets/"
cp "$extension_root/assets/icon128.png" "$release_stage/assets/"
cp "$extension_root/assets/silkscreen-regular.ttf" "$release_stage/assets/"
cp "$extension_root/assets/silkscreen-bold.ttf" "$release_stage/assets/"
cp "$extension_root/assets/figma/winamp-mark.svg" "$release_stage/assets/figma/"
cp "$extension_root/assets/figma/winamp-title.png" "$release_stage/assets/figma/"
cp "$extension_root/assets/figma/main-controller.png" "$release_stage/assets/figma/"
cp "$extension_root/assets/figma/frame-3.png" "$release_stage/assets/figma/"
cp "$extension_root/assets/figma/volume.png" "$release_stage/assets/figma/"
cp "$extension_root/assets/figma/playlist-controller.png" "$release_stage/assets/figma/"
cp "$extension_root/vendor/hls.min.js" "$release_stage/vendor/"
cp "$extension_root/vendor/hls.LICENSE" "$release_stage/vendor/"

rm -f "$archive_path"
(
  cd "$release_stage"
  zip -qr "$archive_path" .
)

unzip -tq "$archive_path"
printf '%s\n' "$archive_path"
