!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Preparing InfinityCoder model directory..."
  CreateDirectory "$APPDATA\\com.miron.infinitycoder"
  CreateDirectory "$APPDATA\\com.miron.infinitycoder\\models"

  DetailPrint "Downloading and validating Qwen 2.5 Coder 7B (~4.68 GB)..."
  ExecWait '"$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\\resources\\download-qwen.ps1"' $0

  ; NSIS has no runtime "If" command. Check PowerShell's exit code with StrCmp.
  StrCmp $0 "0" qwen_ok
  MessageBox MB_ICONSTOP "Qwen model setup failed. InfinityCoder cannot start the local AI engine."
  Abort

qwen_ok:
  DetailPrint "Qwen model is ready."
!macroend
