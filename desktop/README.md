# Post-it 바탕화면 위젯 (Windows)

폰 위젯과 같은 일을 하는 작은 Electron 앱입니다. 웹앱·폰과 같은 Firebase 데이터를 씁니다.

- 고정한 글을 입력란에 띄워 그 자리에서 고쳐 쓰기 (입력을 멈추고 0.7초 뒤, 또는 포커스가 빠질 때 저장)
- 복사 버튼 → 입력란의 글을 클립보드로 (파일 글이면 파일을, 아래 "사진·파일" 참고)
- ＋ 아이콘 → 새 글 쓰기. 저장되는 순간 위젯에 고정
- 왼쪽 위 화살표 → 윗줄만 남기고 접기 / 펼치기 (상태는 기억)
- 클립보드 아이콘 → 지금 클립보드를 새 글로 저장하고 고정 (글자뿐 아니라 사진·파일도)
- 위젯 안에서 **Ctrl+V** → 클립보드에 글자 없이 파일(탐색기에서 복사)이나 캡처한 그림만 있으면 클립보드 아이콘과 같이 올립니다.
  글자가 있으면 평소처럼 입력란에 붙습니다.
- 파일을 위젯에 **끌어다 놓기** → 그 파일들을 한 글로 올리고 고정
- 평소에는 반투명(40%), 커서가 올라오면 또렷하게. 알림이 떠 있는 동안에도 또렷
- 트레이 아이콘 / 위젯의 ✕ / `Post-it.exe --toggle` 로 껐다 켜기 (`--show`, `--hide` 도 있음)
- 처음 실행 때 Windows 시작 시 자동 실행을 켭니다(트레이 메뉴에서 끌 수 있음)

## 사진·파일

웹앱·폰과 같은 규약([`docs/FILES.md`](../docs/FILES.md))을 따릅니다. 파일 본체는 Cloud Storage 의
`users/{uid}/{noteId}/{i}/{name}` 에, 글에는 이름·크기와 미리보기(`thumb`)만 둡니다.

- **클립보드 아이콘**은 클립보드를 이 순서로 봅니다.
  1. 탐색기에서 복사한 파일(여러 개 가능, 최대 10개) — 폴더는 건너뜁니다
  2. 캡처한 그림(`Win+Shift+S` 등) — `이미지-YYYYMMDD-HHMMSS.png` 로 올림
  3. 글자 — 지금까지와 같음

  엑셀 셀처럼 글자와 그림이 함께 복사된 경우는 글자로 저장합니다. 파일 하나는 10MB(소유자 100MB)까지이고,
  넘으면 올리기 전에 알려 줍니다. 다 올린 뒤 글과 고정을 한 번에 쓰고, 그 쓰기가 실패하면 올린 파일을 지웁니다.
- 고정한 글이 파일 글이면 입력란 대신 **미리보기와 파일 이름·크기**가 뜹니다. 파일 글은 고쳐 쓸 수 없고,
  ＋ 로 새 글을 쓰는 것은 그대로 됩니다. 접으면 윗줄에 파일 이름이 보입니다.
- 파일 글의 **복사**는 파일을 `%APPDATA%\Post-it\received\{noteId}\` 에 받아 두고(같은 크기로 이미 있으면 다시
  받지 않음, 최근 글 20개 분만 남김) 그 파일들을 클립보드에 올립니다. 탐색기에 붙여넣으면 파일이 생기고,
  그림 한 장이면 카톡·문서에 붙여넣을 때 그림으로 들어갑니다.

Storage 는 위젯 화면(file://)에서 부르면 CORS 에 막혀서, 메인 프로세스(`src/storage.js`)가 로그인한 사용자의
ID 토큰으로 REST API 를 직접 부릅니다. 권한은 `storage.rules` 가 그 토큰으로 판단합니다.
Windows 의 파일 목록 클립보드는 Electron 이 다루지 못해서 `src/clip.js` 가 PowerShell 을 잠깐 띄워 읽고 씁니다
(경로는 스크립트에 끼워 넣지 않고 환경 변수로 넘깁니다).

## 로그인 방식

Google 은 앱 안에 넣은 브라우저에서의 로그인을 막습니다. 그래서 위젯이 `127.0.0.1` 에만 여는
임시 서버를 띄우고 기본 브라우저로 `http://localhost:{port}/login` 을 엽니다. `localhost` 는
Firebase 가 기본으로 허용하는 도메인이라 웹앱과 같은 팝업 로그인이 됩니다. 로그인이 끝나면 그
페이지가 Google ID 토큰을 (이번 로그인에만 쓰는 state 값과 함께) 위젯에 넘기고, 위젯은 그것으로
Firebase 에 로그인합니다. 브라우저 쪽 세션은 바로 로그아웃하고, 위젯의 로그인은 IndexedDB 에 남습니다.

> Firebase 콘솔 → Authentication → 설정 → 승인된 도메인에서 `localhost` 를 지우면 안 됩니다.

## 개발

```bash
cd desktop
npm install
npm start               # 빌드 후 실행
npm run test:e2e        # Firebase 에뮬레이터(auth, database, storage) + Playwright 로 실제 앱 E2E (JDK 21 이상 필요)
npm run dist            # release/post-it-desktop-setup.exe (NSIS, 사용자별 설치)
npm run test:sandbox    # 만든 설치 파일을 Windows 샌드박스에서 설치 → 반투명 측정 → 재부팅 후 자동 실행 확인
```

- E2E 는 진짜 OS 커서를 움직이고 클립보드를 씁니다(파일 목록 확인에 PowerShell 사용). 도는 동안 마우스를 건드리지 마세요.
  자동 실행 검사는 `PostIt-E2E-<pid>` 라는 이름으로 등록했다가 지웁니다.
- 샌드박스 검사는 Windows 샌드박스(Windows 11 Pro/Education 기능)가 켜져 있어야 하고,
  도는 동안 샌드박스 창이 화면에 뜹니다. 결과는 `sandbox/out/*.json` 과 스크린샷에 남습니다.

| 경로 | 내용 |
|---|---|
| `src/main.js` | 창, 트레이, 커서 감지, 자동 실행, 명령줄 |
| `src/storage.js` | Cloud Storage REST (올리기·받기·지우기) |
| `src/clip.js` | 클립보드 ↔ 사진·파일 (미리보기, 받아 둔 파일, PowerShell) |
| `src/auth-server.js` | 로그인용 로컬 서버 |
| `src/renderer/` | 위젯 화면 |
| `src/login/` | 기본 브라우저에서 여는 로그인 페이지 |
| `src/shared/firebase.js` | Firebase 설정 (웹앱의 `js/firebase-config.js` 를 그대로 씀) |
| `e2e/` | Playwright E2E |
| `sandbox/` | Windows 샌드박스 검증 스크립트 |
