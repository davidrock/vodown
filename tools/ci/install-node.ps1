$ErrorActionPreference = 'Stop'
$version = (Get-Content .node-version).Trim()
$destination = Join-Path $env:TEMP "vodown-node-$version"
if (!(Test-Path "$destination/node.exe")) {
  $filename = "node-v$version-win-x64.zip"
  $root = "https://nodejs.org/dist/v$version"
  Invoke-WebRequest "$root/$filename" -OutFile "$destination.zip"
  $checksums = (Invoke-WebRequest "$root/SHASUMS256.txt" -UseBasicParsing).Content
  $expected = (($checksums -split "`n" | Where-Object { $_.Trim().EndsWith("  $filename") }) -split '\s+')[0]
  if (!$expected -or (Get-FileHash "$destination.zip" -Algorithm SHA256).Hash.ToLower() -ne $expected) { throw 'Node checksum mismatch' }
  Expand-Archive "$destination.zip" -DestinationPath "$destination-extracted" -Force
  Move-Item "$destination-extracted/node-v$version-win-x64" $destination
}
$env:PATH = "$destination;$env:APPDATA/npm;$env:PATH"
node --version
