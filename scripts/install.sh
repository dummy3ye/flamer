#!/usr/bin/env sh
set -eu

package="flamerjs"
repo="dummy3ye/flamer"
version="${FLAMER_VERSION:-}"
mode="${1:-npm}"

if [ "$mode" = "npm" ]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is required to install $package" >&2
    exit 1
  fi
  exec npm install --global "$package${version:+@$version}"
fi

if [ "$mode" != "native" ]; then
  echo "usage: $0 [npm|native]" >&2
  exit 2
fi

if [ -z "$version" ]; then
  echo "set FLAMER_VERSION (for example 1.0.0) for native installation" >&2
  exit 2
fi

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$os-$arch" in
  linux-x86_64) target="linux-x64" ;;
  linux-aarch64) target="linux-arm64" ;;
  darwin-x86_64) target="darwin-x64" ;;
  darwin-arm64) target="darwin-arm64" ;;
  *)
    echo "unsupported native platform: $os-$arch" >&2
    exit 1
    ;;
esac

asset="flamer-core-rust-$target"
url="https://github.com/$repo/releases/download/v$version/$asset"
cache="${XDG_CACHE_HOME:-$HOME/.cache}/flamer"
mkdir -p "$cache"
destination="$cache/$asset"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required for native installation" >&2
  exit 1
fi

echo "Downloading $url"
curl --fail --location --silent --show-error "$url" --output "$destination"
chmod 755 "$destination"
echo "Installed native Flamer worker at $destination"
echo "Use it with: FLAMER_CORE=$destination flamerjs . --engine native"
