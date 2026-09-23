# 새 APK 내기 (소유자용)

교사들은 앱 스토어가 아니라 GitHub Releases 의 **최신 릴리스**에서 APK를 받습니다.
주소는 항상 같습니다: `https://github.com/sehunYang/post-it/releases/latest/download/post-it.apk`
앱은 하루 두 번 GitHub API 로 최신 태그를 확인해 새 버전이 있으면 "내려받기" 배너를 띄웁니다.

## 준비물 (한 번만)

- `android/keystore/post-it-release.jks` 와 `android/keystore.properties`
  둘 다 **커밋되지 않습니다**(.gitignore). 잃어버리면 기존 설치 위에 업데이트를 덮어쓸 수 없으니
  Google Drive 등에 백업해 두세요.
- 이 키의 SHA-1 이 Firebase 콘솔 → 프로젝트 설정 → Android 앱 `kr.ai.shy.postit` 에 등록돼 있어야
  배포된 APK에서 Google 로그인이 됩니다.
  ```
  0C:E5:20:29:62:E1:1E:D8:37:5D:3C:E6:E2:72:0C:9F:0C:09:9C:7D
  ```
- `gh` CLI 로그인 (`gh auth status`)

## 순서

1. `android/app/build.gradle.kts` 에서 `versionCode` 를 1 올리고 `versionName` 을 정합니다 (예: `"1.2"`).
2. 빌드:
   ```bash
   cd android
   ./gradlew assembleRelease
   ```
   결과: `android/app/build/outputs/apk/release/app-release.apk`
3. 릴리스 (태그는 `v` + versionName 이어야 앱의 버전 비교가 맞습니다):
   ```bash
   cp android/app/build/outputs/apk/release/app-release.apk post-it.apk
   gh release create v1.2 post-it.apk --title "v1.2" --notes "무엇이 바뀌었는지 한두 줄"
   rm post-it.apk
   ```
   파일 이름은 반드시 `post-it.apk` 여야 고정 주소가 유지됩니다.

## 확인

- `https://github.com/sehunYang/post-it/releases/latest/download/post-it.apk` 가 새 파일을 내려주는지
- 폰에 설치된 이전 버전 위에 그대로 덮어 설치되는지 (서명 키가 같아야 됩니다)
- 앱을 열었을 때 업데이트 배너가 사라졌는지

## 바탕화면 위젯 (Windows) 함께 내기

웹앱의 내려받기 버튼은 `releases/latest/download/post-it-desktop-setup.exe` 를 가리킵니다.
"최신 릴리스"는 하나뿐이므로 **APK 와 설치 파일을 같은 릴리스에 함께 올려야** 둘 다 끊기지 않습니다.

1. `desktop/package.json` 의 `version` 을 올립니다.
2. 빌드와 검증:
   ```bash
   cd desktop
   npm run test:e2e
   npm run dist            # → desktop/release/post-it-desktop-setup.exe
   npm run test:sandbox    # 깨끗한 Windows 에서 설치·자동 실행 확인
   ```
3. 릴리스에 함께 올립니다:
   ```bash
   gh release create v1.2 post-it.apk desktop/release/post-it-desktop-setup.exe --title "v1.2" --notes "…"
   # 이미 만든 릴리스에 더하려면
   gh release upload v1.2 desktop/release/post-it-desktop-setup.exe
   ```

설치 파일은 코드 서명이 없어서 처음 열 때 SmartScreen 경고가 뜹니다(추가 정보 → 실행).
