; 제거할 때, 앱이 스스로 등록한 "Windows 시작 시 자동 실행" 값도 함께 지웁니다.
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Post-it"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Post-it"
!macroend
