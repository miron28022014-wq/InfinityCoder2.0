!include "LogicLib.nsh"

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Preparing InfinityCoder model directory..."
  CreateDirectory "$APPDATA\com.miron.infinitycoder"
  CreateDirectory "$APPDATA\com.miron.infinitycoder\models"

  IfFileExists "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf" model_ready

  DetailPrint "Downloading Qwen 2.5 Coder 7B Q4_K_M (~5 GB)..."
  DetailPrint "This may take several minutes depending on your connection."

  ExecWait '"$SYSDIR\curl.exe" --location --fail --retry 5 --retry-all-errors --continue-at - --output "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf.part" "https://huggingface.co/second-state/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf?download=true"' $0

  ${If} $0 != 0
    MessageBox MB_ICONSTOP "InfinityCoder could not download the Qwen model. Internet access is required during installation. You can rerun the installer later."
    SetErrorLevel 2
    Return
  ${EndIf}

  IfFileExists "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf.part" 0 download_failed
  Rename "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf.part" "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf"
  IfFileExists "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf" 0 download_failed

model_ready:
  DetailPrint "Qwen model is ready."
  Goto done

download_failed:
  MessageBox MB_ICONSTOP "The Qwen model download did not complete. InfinityCoder was installed, but the AI engine cannot start until the model is downloaded."
  SetErrorLevel 2

done:
!macroend
