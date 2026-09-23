# Post-it

**<https://shy.ai.kr/post-it/>**

옮기고 싶은 말을 데스크톱에서 적어두면, 갤럭시 홈 화면 위젯을 한 번 눌러 클립보드에 붙여넣습니다.
반대로 폰에서 적거나 공유한 글도 데스크톱에 바로 나타납니다.

설치도, 설정도 없습니다. **Google 계정으로 로그인하면 바로 씁니다.**

## 쓰는 법

1. **<https://shy.ai.kr/post-it/>** 을 열고 **Google 계정으로 시작하기**
2. 로그인하면 보이는 **"폰에 위젯 설치하기"** QR을 폰 카메라로 찍습니다
3. 폰에서 **APK 내려받기** → 파일 열기 → 설치. "이 출처의 앱 설치 허용"을 한 번 켜 줍니다
4. 앱을 열어 **같은 Google 계정**으로 로그인 → **홈 화면에 위젯 추가**

끝입니다. 웹에서 글을 적고 **위젯에 고정**하면 폰 위젯에 뜨고, 위젯을 누르면 클립보드로 들어갑니다.

폰 설치 페이지: **<https://shy.ai.kr/post-it/install/>**

### Windows 바탕화면 위젯 (선택)

폰 위젯과 같은 일을 데스크톱에서 합니다. 고정한 글을 화면 구석에 띄워 두고, 누르면 클립보드로 복사합니다.

1. 웹앱의 **"바탕화면 위젯 설치하기"** 에서 `post-it-desktop-setup.exe` 를 내려받아 엽니다.
   서명되지 않은 앱이라 "Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행**을 누릅니다.
2. 위젯의 **Google 계정으로 로그인** → 기본 브라우저가 열리면 **같은 Google 계정**으로 로그인
3. 끝. 평소에는 **반투명**하게 비켜 있다가 **마우스를 올리면 또렷**해지고, **컴퓨터를 켜면 저절로** 뜹니다.

- **끄고 켜기**: 작업 표시줄 오른쪽의 Post-it 트레이 아이콘을 누르거나, 위젯의 ✕ 를 누릅니다.
  트레이 메뉴에서 항상 위에 표시 · Windows 시작 시 자동 실행 · 위치 초기화 · 로그아웃 · 종료를 고릅니다.
- **옮기기**: 위젯 윗줄(Post-it 글자 쪽)을 잡고 끌면 됩니다. 위치는 기억됩니다.
- **클립보드 아이콘**: 지금 클립보드의 글을 새 글로 저장합니다(데스크톱 → 폰).

## 알아둘 점

- **무료입니다.** 만든 사람의 Firebase 무료 한도 안에서 여러 사람이 같이 씁니다. 그래서 글 하나는 **5,000자까지** 저장됩니다.
- **내 글은 내 계정만 봅니다.** 보안 규칙이 로그인한 계정의 데이터만 열어 줍니다. 다만 데이터베이스 자체는 만든 사람의 Firebase 프로젝트에 있으므로, 비밀번호나 개인정보처럼 민감한 내용은 넣지 않는 편이 좋습니다.
- **위젯에 보이는 글자는 15~30분 주기로 갱신됩니다.** 무료 티어에는 서버가 폰을 깨우는 수단이 없어서입니다. 새로 고침 아이콘을 누르거나 앱을 열면 즉시 갱신됩니다.
- **위젯을 눌러 복사되는 내용은 항상 최신입니다.** 누르는 순간 서버에서 다시 읽어옵니다.
- **위젯을 누르면 화면이 잠깐 깜빡입니다.** Android 10부터 백그라운드에서는 클립보드를 만질 수 없어서, 투명한 화면을 아주 잠깐 띄웠다 닫습니다. 정상입니다.
- **새 버전이 나오면 앱 안에 "내려받기" 안내가 뜹니다.** 앱 스토어를 거치지 않으므로 그 버튼으로 받아 덮어 설치하면 됩니다.

## 구조

```
데스크톱 브라우저                              갤럭시 폰
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

- **웹앱** — GitHub Pages (정적 호스팅, 무료)
- **데이터베이스** — Firebase Realtime Database (Spark 무료 티어). 규칙은 [`database.rules.json`](database.rules.json)
- **위젯** — 네이티브 안드로이드 앱 (Kotlin). APK는 [Releases](https://github.com/sehunYang/post-it/releases)
- **바탕화면 위젯** — Windows용 Electron 앱. 설치 파일도 같은 Releases 에 있습니다
- **디자인** — [shy.ai.kr](https://shy.ai.kr) 의 디자인 시스템을 그대로 따릅니다.

## 폴더

| 경로 | 내용 |
|---|---|
| `index.html`, `css/`, `js/` | 웹앱 (GitHub Pages가 저장소 루트를 그대로 서빙) |
| `install/` | 폰 설치 안내 페이지 (QR이 여기로 옵니다) |
| `desktop/` | Windows 바탕화면 위젯 (Electron) — [desktop/README.md](desktop/README.md) |
| `database.rules.json` | Realtime Database 보안 규칙 |
| `android/` | 안드로이드 앱 + 위젯 (Gradle 프로젝트) |
| `docs/SETUP.md` | 소유자용: 처음 한 번 하는 Firebase 설정 |
| `docs/RELEASE.md` | 소유자용: 새 APK 내는 순서 |

## 직접 만들거나 고치려면

이 저장소를 그대로 자기 Firebase 프로젝트에 붙일 수 있습니다. [docs/SETUP.md](docs/SETUP.md) 를 따라가세요.

```bash
cd android
./gradlew assembleDebug     # → app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease   # keystore.properties 가 있으면 릴리스 키로 서명
```

- AGP 8.13.2 · Gradle 8.14.3 · Kotlin 2.2.20 · JDK 17 타깃
- compileSdk / targetSdk 36, minSdk 26
