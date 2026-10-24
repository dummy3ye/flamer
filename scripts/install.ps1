$ErrorActionPreference = "Stop"

$package = "flamerjs"
$version = if ($env:FLAMER_VERSION) { $env:FLAMER_VERSION } else { "1.1.3" }
$architecture = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
$target = "win32-$architecture"
$repo = "dummy3ye/flamer"
$cache = if ($env:FLAMER_NATIVE_DIR) { $env:FLAMER_NATIVE_DIR } else { Join-Path $env:LOCALAPPDATA "flamer\bin" }
$baseUrl = "https://github.com/$repo/releases/download/v$version"

New-Item -ItemType Directory -Force -Path $cache | Out-Null
$checksumFile = Join-Path $cache "checksums-$target.txt"
Invoke-WebRequest "$baseUrl/checksums-$target.txt" -OutFile $checksumFile
foreach ($asset in @("flamer-core-rust-$target.exe", "flamer-core-cpp-$target.exe")) {
  Invoke-WebRequest "$baseUrl/$asset" -OutFile (Join-Path $cache $asset)
}

$checksums = Get-Content $checksumFile
foreach ($line in $checksums) {
  $parts = $line -split "\s+", 2
  $actual = (Get-FileHash (Join-Path $cache $parts[1]) -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $parts[0].ToLower()) { throw "Checksum mismatch for $($parts[1])" }
}

npm install --global "$package@$version"
Write-Host "Installed full Flamer toolchain. Run: flamer ."
