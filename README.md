# Post-it

**<https://shy.ai.kr/post-it/>**

옮기고 싶은 말을 데스크톱에서 적어두면, 갤럭시 홈 화면 위젯을 한 번 눌러 클립보드에 붙여넣습니다.
반대로 폰에서 적거나 공유한 글도 데스크톱에 바로 나타납니다.

- **웹앱** — GitHub Pages (정적 호스팅, 무료)
- **데이터베이스** — Firebase Realtime Database (Spark 무료 티어)
- **위젯** — 네이티브 안드로이드 앱 (Kotlin)
- **디자인** — [shy.ai.kr](https://shy.ai.kr) 의 디자인 시스템을 그대로 따릅니다.

## 구조

```
데스크톱 브라우저                              갤럭시 Z 플립 5
GitHub Pages 웹앱                             네이티브 앱 + 홈 화면 위젯
  · Google 로그인                               · 같은 Google 계정으로 로그인
  · 글 입력 / 수정 / 삭제                        · 위젯에 고정된 글 표시
  · 항목별 클립보드 복사                          · 위젯 탭 → 클립보드로 복사
  · 위젯에 띄울 글 고정                          · 위젯의 클립보드 아이콘 → 지금 클립보드를 새 글로 저장
                                              · 다른 앱에서 "공유 → Post-it"
        └──────────► Firebase Realtime Database ◄──────────┘
                     users/{uid}/notes/{id}  { text, createdAt, updatedAt }
                     users/{uid}/pinned      "{noteId}"
```

두 계정이 같은 Google 계정이면 UID가 같으므로, 보안 규칙 한 줄(`auth.uid === $uid`)로
양쪽 모두 자기 데이터에만 접근합니다.

## 폴더

| 경로 | 내용 |
|---|---|
| `index.html`, `css/`, `js/` | 웹앱 (GitHub Pages가 저장소 루트를 그대로 서빙) |
| `js/firebase-config.js` | **직접 채워야 하는** Firebase 설정값 |
| `database.rules.json` | Realtime Database 보안 규칙 |
| `android/` | 안드로이드 앱 + 위젯 (Gradle 프로젝트) |
| `docs/SETUP.md` | 처음 한 번 하는 설정 순서 |

## 시작하기

[docs/SETUP.md](docs/SETUP.md) 를 순서대로 따라가세요. 요약하면:

1. Firebase 프로젝트 생성 → Google 로그인 켜기 → **Realtime Database 생성**
2. `database.rules.json` 규칙 게시
3. 웹 앱 등록 → `js/firebase-config.js` 채우기 → 승인된 도메인에 `shy.ai.kr` 추가
4. 안드로이드 앱 등록(패키지 `kr.ai.shy.postit` + SHA-1) → `google-services.json` 을 `android/app/` 에
5. `cd android && ./gradlew assembleDebug` → APK를 폰에 설치 → 위젯 배치

## 안드로이드 빌드

```bash
cd android
./gradlew assembleDebug     # → app/build/outputs/apk/debug/app-debug.apk
```

`google-services.json` 이 없어도 빌드 자체는 성공합니다(플러그인을 조건부로 적용).
다만 앱을 실행하면 설정이 없다는 안내가 뜹니다.

- AGP 8.13.2 · Gradle 8.14.3 · Kotlin 2.2.20 · JDK 17 타깃
- compileSdk / targetSdk 36, minSdk 26

## 알아둘 점

**위젯에 보이는 글자는 15~30분 주기로 갱신됩니다.** 무료 티어에는 서버 → 폰 실시간 푸시
수단이 없기 때문입니다(그건 Cloud Functions, 즉 유료 Blaze 요금제가 필요합니다).
새로 고침 아이콘을 누르거나 앱을 열면 즉시 갱신됩니다.

**위젯을 눌러 복사되는 내용은 항상 최신입니다.** 누르는 순간 서버에서 다시 읽어오기 때문에,
화면에 옛 글이 보이더라도 클립보드에는 지금 고정된 글이 들어갑니다.

**클립보드를 만지려면 화면이 필요합니다.** Android 10부터 백그라운드에서는 클립보드를
읽거나 쓸 수 없어서, 위젯 탭은 보이지 않는 투명 액티비티(`ClipActivity`)를 아주 잠깐 띄운 뒤
종료합니다. 화면이 깜빡이는 것처럼 보이면 그것이 정상 동작입니다.
