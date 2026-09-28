!include "LogicLib.nsh"

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Preparing InfinityCoder model directory..."
  CreateDirectory "$APPDATA\com.miron.infinitycoder"
  CreateDirectory "$APPDATA\com.miron.infinitycoder\models"

  IfFileExists "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf" model_ready

  DetailPrint "Downloading Qwen 2.5 Coder 7B Q4_K_M (~4.68 GB)..."
  DetailPrint "This may take several minutes depending on your connection."

download_required:
  ExecWait '"$SYSDIR\curl.exe" --location --fail --retry 5 --retry-all-errors --continue-at - --output "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf.part" "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf?download=true"' $0
  StrCmp $0 "0" download_ok download_failed

download_ok:
  IfFileExists "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf.part" 0 download_failed
  Rename "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf.part" "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf"
  IfFileExists "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf" 0 download_failed
  Goto model_ready

model_ready:
  DetailPrint "Qwen model is ready."
  Goto done

download_failed:
  MessageBox MB_ICONSTOP "The Qwen model download did not complete. InfinityCoder was installed, but the AI engine cannot start until the model is downloaded."
  SetErrorLevel 2

done:
!macroend
