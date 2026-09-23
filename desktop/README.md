# Post-it 바탕화면 위젯 (Windows)

폰 위젯과 같은 일을 하는 작은 Electron 앱입니다. 웹앱·폰과 같은 Firebase 데이터를 씁니다.

- 고정한 글을 보여 주고, 누르면 클립보드로 복사
- 클립보드 아이콘 → 지금 클립보드를 새 글로 저장
- 평소에는 반투명(40%), 커서가 올라오면 또렷하게. 알림이 떠 있는 동안에도 또렷
- 트레이 아이콘 / 위젯의 ✕ / `Post-it.exe --toggle` 로 껐다 켜기 (`--show`, `--hide` 도 있음)
- 처음 실행 때 Windows 시작 시 자동 실행을 켭니다(트레이 메뉴에서 끌 수 있음)

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
npm run test:e2e        # Firebase 에뮬레이터(auth, database) + Playwright 로 실제 앱 E2E (JDK 필요)
npm run dist            # release/post-it-desktop-setup.exe (NSIS, 사용자별 설치)
npm run test:sandbox    # 만든 설치 파일을 Windows 샌드박스에서 설치 → 반투명 측정 → 재부팅 후 자동 실행 확인
```

- E2E 는 진짜 OS 커서를 움직이고 클립보드를 씁니다. 도는 동안 마우스를 건드리지 마세요.
  자동 실행 검사는 `PostIt-E2E-<pid>` 라는 이름으로 등록했다가 지웁니다.
- 샌드박스 검사는 Windows 샌드박스(Windows 11 Pro/Education 기능)가 켜져 있어야 하고,
  도는 동안 샌드박스 창이 화면에 뜹니다. 결과는 `sandbox/out/*.json` 과 스크린샷에 남습니다.

| 경로 | 내용 |
|---|---|
| `src/main.js` | 창, 트레이, 커서 감지, 자동 실행, 명령줄 |
| `src/auth-server.js` | 로그인용 로컬 서버 |
| `src/renderer/` | 위젯 화면 |
| `src/login/` | 기본 브라우저에서 여는 로그인 페이지 |
| `src/shared/firebase.js` | Firebase 설정 (웹앱의 `js/firebase-config.js` 를 그대로 씀) |
| `e2e/` | Playwright E2E |
| `sandbox/` | Windows 샌드박스 검증 스크립트 |
