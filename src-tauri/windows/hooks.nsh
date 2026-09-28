!include "LogicLib.nsh"

!define QWEN_URL "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf?download=true"
!define QWEN_SHA256 "509287f78cb4d4cf6b3843734733b914b2c158e43e22a7f4bf5e963800894d3c"

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Preparing InfinityCoder model directory..."
  CreateDirectory "$APPDATA\com.miron.infinitycoder"
  CreateDirectory "$APPDATA\com.miron.infinitycoder\models"

  StrCpy $0 "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf"
  StrCpy $1 "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf.part"

  IfFileExists "$0" 0 download_required
  DetailPrint "Existing Qwen model found; validating SHA-256..."
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$h=(Get-FileHash -LiteralPath ''$0'' -Algorithm SHA256).Hash.ToLower(); if($h -ne ''\${QWEN_SHA256}''){exit 1}"' $2
  StrCmp $2 "0" model_ready
  DetailPrint "Existing Qwen model failed SHA-256 validation; deleting it..."
  Delete "$0"

download_required:
  Delete "$1"
  DetailPrint "Downloading Qwen 2.5 Coder 7B Q4_K_M (~4.68 GB)..."
  ExecWait '"$SYSDIR\curl.exe" --location --fail --retry 5 --retry-all-errors --connect-timeout 30 --speed-time 60 --speed-limit 1024 --output "$1" "\${QWEN_URL}"' $3
  StrCmp $3 "0" download_ok download_failed

download_ok:
  IfFileExists "$1" 0 download_failed
  DetailPrint "Validating downloaded Qwen model SHA-256..."
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$h=(Get-FileHash -LiteralPath ''$1'' -Algorithm SHA256).Hash.ToLower(); if($h -ne ''\${QWEN_SHA256}''){exit 1}"' $2
  StrCmp $2 "0" hash_ok download_bad_hash

hash_ok:
  Delete "$0"
  Rename "$1" "$0"
  IfFileExists "$0" 0 download_failed
  DetailPrint "Qwen model is ready."
  Goto done

download_bad_hash:
  Delete "$1"
  MessageBox MB_ICONSTOP "The Qwen model checksum is invalid. The installation cannot be completed safely."
  Abort

download_failed:
  Delete "$1"
  MessageBox MB_ICONSTOP "The Qwen model could not be downloaded. InfinityCoder cannot start its local AI engine without the model. Check your internet connection and run the installer again."
  Abort

model_ready:
  DetailPrint "Qwen model is already valid."

done:
!macroend
