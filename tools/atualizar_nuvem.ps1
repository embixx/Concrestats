# Copia a build mais recente para a pasta da nuvem (Drive/OneDrive).
# Uso:  powershell -ExecutionPolicy Bypass -File tools\atualizar_nuvem.ps1
$raiz  = Split-Path -Parent $PSScriptRoot
$dist  = Join-Path $raiz "source\dist\Concrestats"
$nuvem = "C:\Users\Administrator\Desktop\Concrestats_Nuvem"

if (-not (Test-Path $dist)) { Write-Host "Build nao encontrada em $dist" -ForegroundColor Red; exit 1 }
New-Item -ItemType Directory -Force -Path $nuvem | Out-Null

$zip = Join-Path $nuvem "Concrestats_ULTIMA_VERSAO.zip"
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path $dist -DestinationPath $zip -CompressionLevel Optimal -Force

$data = Get-Date -Format "dd/MM/yyyy HH:mm"
$leia = Join-Path $nuvem "LEIA-ME.txt"
if (Test-Path $leia) {
  (Get-Content $leia -Raw) -replace "Atualizado em: .*", "Atualizado em: $data" |
    Set-Content $leia -Encoding UTF8
}
Write-Host "Pasta da nuvem atualizada: $zip" -ForegroundColor Green
Write-Host ("Tamanho: {0} MB" -f [math]::Round((Get-Item $zip).Length/1MB,1))
