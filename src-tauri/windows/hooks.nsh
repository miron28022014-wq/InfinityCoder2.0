!include "LogicLib.nsh"

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Preparing InfinityCoder model directory..."
  CreateDirectory "$APPDATA\com.miron.infinitycoder"
  CreateDirectory "$APPDATA\com.miron.infinitycoder\models"

  IfFileExists "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf" verify_existing

  DetailPrint "Downloading Qwen 2.5 Coder 7B Q4_K_M (~4.68 GB)..."
  DetailPrint "This may take several minutes depending on your connection."

  ExecWait '"$SYSDIR\curl.exe" --location --fail --retry 5 --retry-all-errors --continue-at - --output "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf.part" "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf?download=true"' $0

  ${If} $0 != 0
    MessageBox MB_ICONSTOP "InfinityCoder could not download the Qwen model. Internet access is required during installation. You can rerun the installer later."
    SetErrorLevel 2
    Return
  ${EndIf}

  IfFileExists "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf.part" 0 download_failed
  Rename "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf.part" "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf"
  IfFileExists "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf" 0 download_failed

verify_existing:
  DetailPrint "Verifying Qwen model SHA-256..."
  nsExec::ExecToStack 'cmd /C certutil -hashfile "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf" SHA256'
  Pop $0
  Pop $1
  StrCpy $1 $1 64
  IfFileExists "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf" 0 download_required
  StrCmp $1 "509287f78cb4d4cf6b3843734733b914b2c158e43e22a7f4bf5e963800894d3c" model_ready download_required

download_required:
  DetailPrint "Downloading a verified Qwen model copy..."
  Delete "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf"
  ExecWait '"$SYSDIR\curl.exe" --location --fail --retry 5 --retry-all-errors --continue-at - --output "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf.part" "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf?download=true"' $0
  IfErrors download_failed
  IfFileExists "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf.part" 0 download_failed
  Rename "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf.part" "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf"
  Goto verify_existing

model_ready:
  DetailPrint "Qwen model is ready."
  Goto done

download_failed:
  MessageBox MB_ICONSTOP "The Qwen model download did not complete. InfinityCoder was installed, but the AI engine cannot start until the model is downloaded."
  SetErrorLevel 2

done:
!macroend
