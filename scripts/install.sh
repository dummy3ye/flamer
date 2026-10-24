#!/usr/bin/env sh
set -eu

package="flamerjs"
repo="dummy3ye/flamer"
version="${FLAMER_VERSION:-1.1.3}"
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

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$os-$arch" in
  linux-x86_64) target="linux-x64" ;;
  linux-aarch64) target="linux-arm64" ;;
  darwin-x86_64) target="darwin-x64" ;;
  darwin-arm64) target="darwin-arm64" ;;
  mingw*|msys*|cygwin*) echo "use scripts/install.ps1 on Windows" >&2; exit 1 ;;
  *)
    echo "unsupported native platform: $os-$arch" >&2
    exit 1
    ;;
esac

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required for native installation" >&2
  exit 1
fi

if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
  echo "sha256sum or shasum is required for native installation" >&2
  exit 1
fi

cache="${FLAMER_NATIVE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/flamer/bin}"
mkdir -p "$cache"
base_url="https://github.com/$repo/releases/download/v$version"
assets="flamer-core-rust-$target flamer-core-cpp-$target"
if [ "$target" = "win32-x64" ] || [ "$target" = "win32-arm64" ]; then
  assets="flamer-core-rust-$target.exe flamer-core-cpp-$target.exe"
fi

checksum_file="$cache/checksums-$target.txt"
echo "Downloading Flamer $version native workers for $target"
curl --fail --location --silent --show-error "$base_url/checksums-$target.txt" --output "$checksum_file"
for asset in $assets; do
  curl --fail --location --silent --show-error "$base_url/$asset" --output "$cache/$asset"
done

(cd "$cache" && {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "$(basename "$checksum_file")"
  else
    shasum -a 256 -c "$(basename "$checksum_file")"
  fi
})
chmod 755 "$cache"/flamer-core-*

echo "Installing the Flamer CLI from npm"
npm install --global "$package@$version"
echo "Installed full Flamer toolchain."
echo "Run: flamer ."
