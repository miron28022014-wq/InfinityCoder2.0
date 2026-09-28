!include "LogicLib.nsh"

!define QWEN_URL "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf?download=true"
!define QWEN_SHA256 "509287f78cb4d4cf6b3843734733b914b2c158e43e22a7f4bf5e963800894d3c"

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Preparing InfinityCoder model directory..."
  CreateDirectory "$APPDATA\com.miron.infinitycoder"
  CreateDirectory "$APPDATA\com.miron.infinitycoder\models"

  StrCpy $0 "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf"
  StrCpy $1 "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf.part"

  ; Never trust a stale/partial GGUF. A bad GGUF can cause llama.cpp mmap errors.
  IfFileExists "$0" 0 download_required
  DetailPrint "Existing Qwen model found; validating checksum..."
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$h=(Get-FileHash -LiteralPath ''$0'' -Algorithm SHA256).Hash.ToLower(); if($h -ne ''${QWEN_SHA256}''){exit 1}"' $2
  StrCmp $2 "0" model_ready
  DetailPrint "Existing Qwen model failed validation; downloading a clean copy..."
  Delete "$0"

download_required:
  DetailPrint "Downloading Qwen 2.5 Coder 7B Q4_K_M (~4.68 GB)..."
  ExecWait '"$SYSDIR\curl.exe" --location --fail --retry 5 --retry-all-errors --continue-at - --output "$1" "${QWEN_URL}"' $3
  StrCmp $3 "0" download_ok download_failed

download_ok:
  IfFileExists "$1" 0 download_failed
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$h=(Get-FileHash -LiteralPath ''$1'' -Algorithm SHA256).Hash.ToLower(); if($h -ne ''${QWEN_SHA256}''){exit 1}"' $2
  StrCmp $2 "0" hash_ok download_bad_hash

hash_ok:
  Delete "$0"
  Rename "$1" "$0"
  IfFileExists "$0" 0 download_failed
  Goto model_ready

download_bad_hash:
  Delete "$1"
  MessageBox MB_ICONSTOP "The Qwen model checksum is invalid. Please run the installer again."
  Goto done

model_ready:
  DetailPrint "Qwen model is ready."
  Goto done

download_failed:
  Delete "$1"
  MessageBox MB_ICONSTOP "The Qwen model download did not complete. InfinityCoder was installed, but the AI engine cannot start until the model is downloaded."

done:
!macroend
