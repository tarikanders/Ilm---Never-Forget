# Ré-encode les vidéos de fond en 720p H.264 + regénère les posters.
#
# Pourquoi : les fonds sont affichés FLOUTÉS à ~72% d'opacité. Servir du 4K
# (2160x3840, jusqu'à 14 Mo) gaspille la bande passante mobile et étrangle le
# téléchargement de l'audio. 720p est invisible à l'œil ici, ~10-20x plus léger.
#
# Sécurité : background_bank/ est l'UNIQUE copie (gitignorée, pas de backup).
# Le script copie d'abord chaque original dans _background_bank_4k_backup/
# (hors public/, donc ni déployé ni écrasé) AVANT de remplacer. Idempotent :
# relancer ne re-sauvegarde pas et ré-encode depuis le backup 4K (pas de perte
# de qualité cumulée).

$ErrorActionPreference = "Stop"
$root   = Resolve-Path (Join-Path $PSScriptRoot "..")
$bank   = Join-Path $root "public\background_bank"
$backup = Join-Path $root "_background_bank_4k_backup"
$tmp    = Join-Path $bank "_tmp_720"

New-Item -ItemType Directory -Force $backup | Out-Null
New-Item -ItemType Directory -Force $tmp    | Out-Null

$files = Get-ChildItem $bank -Filter *.mp4
$i = 0
foreach ($f in $files) {
  $i++
  $name = $f.Name
  $bak  = Join-Path $backup $name

  # 1. Sauvegarde unique de l'original 4K
  if (-not (Test-Path $bak)) { Copy-Item $f.FullName $bak }

  # 2. Source = toujours le backup 4K (évite la perte de qualité cumulée)
  $src    = $bak
  $out    = Join-Path $tmp $name
  $poster = Join-Path $tmp ($f.BaseName + ".jpg")

  Write-Host "[$i/$($files.Count)] $name"
  # scale=-2:1280 -> hauteur 1280, largeur auto paire (~720 en 9:16)
  # crf 30 + faststart (moov atom en tête -> lecture avant fin du download)
  # -an : fond muet, on jette l'audio
  & ffmpeg -y -hide_banner -loglevel error -i $src `
    -vf "scale=-2:1280" -c:v libx264 -crf 30 -preset medium -an -movflags +faststart $out
  & ffmpeg -y -hide_banner -loglevel error -i $out -frames:v 1 -q:v 5 $poster
}

# 3. Remplacer les originaux du bank par les versions 720p
Get-ChildItem $tmp -File | ForEach-Object {
  Move-Item $_.FullName (Join-Path $bank $_.Name) -Force
}
Remove-Item $tmp -Recurse -Force

$newMB = [math]::Round(((Get-ChildItem $bank -Filter *.mp4 | Measure-Object Length -Sum).Sum/1MB),1)
Write-Host "OK. background_bank MP4 total: $newMB MB (backup 4K: $backup)"
