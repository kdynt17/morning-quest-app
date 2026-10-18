#!/usr/bin/env bash
# assets/sources.txt 의 그림을 내려받아 여백을 잘라내고 webp로 줄여 assets/ 에 저장한다.
# 앱 아이콘(icon-*.png)은 박사 마스코트로 만든다. 한 번 저장되면 다시 실행할 필요 없다.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
grep -v '^#' assets/sources.txt | while read -r name size url; do
  [ -z "$name" ] && continue
  curl -sSfL "$url" -o "$tmp/$name.png"
  inner=$((size * 94 / 100))
  convert "$tmp/$name.png" -trim +repage -resize "${inner}x${inner}" -background none -gravity center \
    -extent "${size}x${size}" -quality 88 -define webp:alpha-quality=95 "assets/$name.webp"
done
for s in 512 192 180; do
  convert -size "${s}x${s}" xc:'#ffd23f' \( "$tmp/mascot-professor.png" -trim +repage -resize "$((s * 80 / 100))x$((s * 80 / 100))" \) \
    -gravity center -composite +dither -colors 128 -define png:compression-level=9 "assets/icon-$s.png"
done
rm -rf "$tmp"
ls -la assets
