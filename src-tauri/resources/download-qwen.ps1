$ErrorActionPreference = "Stop"

$modelDir = Join-Path $env:APPDATA "com.miron.infinitycoder\models"
$model = Join-Path $modelDir "qwen-coder.gguf"
$part = "$model.part"

$url = "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf?download=true"
$expected = "509287f78cb4d4cf6b3843734733b914b2c158e43e22a7f4bf5e963800894d3c"

New-Item -ItemType Directory -Force -Path $modelDir | Out-Null

if (Test-Path $model) {
    $hash = (Get-FileHash -LiteralPath $model -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -eq $expected) {
        Write-Host "Qwen model is already valid."
        exit 0
    }
    Remove-Item -Force $model
}

if (Test-Path $part) { Remove-Item -Force $part }

Write-Host "Downloading Qwen 2.5 Coder 7B Q4_K_M (~4.68 GB)..."
$curl = Join-Path $env:SystemRoot "System32\curl.exe"
if (-not (Test-Path $curl)) {
    throw "Windows curl.exe was not found."
}

& $curl --location --fail --retry 5 --retry-all-errors --connect-timeout 30 --speed-time 60 --speed-limit 1024 --output $part $url
if ($LASTEXITCODE -ne 0) {
    throw "Qwen download failed with curl exit code $LASTEXITCODE."
}

if (-not (Test-Path $part)) {
    throw "Qwen download did not create the model file."
}

Write-Host "Validating Qwen SHA-256..."
$hash = (Get-FileHash -LiteralPath $part -Algorithm SHA256).Hash.ToLowerInvariant()
if ($hash -ne $expected) {
    Remove-Item -Force $part
    throw "Qwen SHA-256 mismatch. Expected $expected, got $hash."
}

Move-Item -Force $part $model
Write-Host "Qwen model is ready."
exit 0
