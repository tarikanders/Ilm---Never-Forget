# Transcode background_bank 4K -> public/background_bank 1080x1920 light + posters
$ErrorActionPreference = "Stop"
$src = "background_bank"
$dst = "public/background_bank"
New-Item -ItemType Directory -Force -Path $dst | Out-Null

$ff = "ffmpeg"
$log = "scripts/transcode.log"
"START $(Get-Date -Format o)" | Out-File $log -Encoding utf8

$videos = Get-ChildItem $src -Filter *.mp4
$i = 0
foreach ($v in $videos) {
  $i++
  $base = [IO.Path]::GetFileNameWithoutExtension($v.Name)
  $outMp4 = Join-Path $dst ($base + ".mp4")
  $outJpg = Join-Path $dst ($base + ".jpg")
  "[$i/$($videos.Count)] $($v.Name)" | Tee-Object -FilePath $log -Append

  # Video: 1080x1920, H.264, no audio, faststart, crf 28
  & $ff -y -hide_banner -loglevel error -i $v.FullName `
    -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30" `
    -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p -movflags +faststart -an `
    $outMp4 2>> $log
  if ($LASTEXITCODE -ne 0) { "  VIDEO FAIL $($v.Name)" | Out-File $log -Append }

  # Poster: frame @1s, 1080 wide jpg
  & $ff -y -hide_banner -loglevel error -ss 1 -i $v.FullName `
    -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" `
    -frames:v 1 -q:v 4 $outJpg 2>> $log
  if ($LASTEXITCODE -ne 0) { "  POSTER FAIL $($v.Name)" | Out-File $log -Append }
}

# Copy/downscale existing still images (pexels-*.jpg)
$imgs = Get-ChildItem $src -Filter *.jpg
foreach ($img in $imgs) {
  $outJpg = Join-Path $dst $img.Name
  "IMG $($img.Name)" | Out-File $log -Append
  & $ff -y -hide_banner -loglevel error -i $img.FullName `
    -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" `
    -q:v 4 $outJpg 2>> $log
}

"DONE $(Get-Date -Format o)" | Out-File $log -Append
Get-ChildItem $dst | Measure-Object Length -Sum | ForEach-Object { "OUTPUT: $($_.Count) files, {0:N1} MB" -f ($_.Sum/1MB) } | Out-File $log -Append
