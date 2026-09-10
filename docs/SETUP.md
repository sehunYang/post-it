# 설정 가이드

처음 한 번만 하면 되는 작업입니다. **순서를 지켜 주세요** — 특히 3단계(Realtime Database 생성)를
7단계(google-services.json 내려받기)보다 먼저 해야 합니다. 그러지 않으면 안드로이드 앱이
데이터베이스 주소를 모른 채 빌드됩니다.

---

## 1. Firebase 프로젝트 만들기

1. <https://console.firebase.google.com> 접속 → **프로젝트 추가**
2. 이름: `post-it` (원하는 이름 아무거나)
3. Google 애널리틱스는 **사용 안 함**으로 두어도 됩니다.
4. 요금제는 **Spark(무료)** 그대로 둡니다. 신용카드가 필요 없습니다.

---

## 2. Authentication — Google 로그인 켜기

1. 왼쪽 메뉴 **빌드 → Authentication** → **시작하기**
2. **Sign-in method** 탭 → **Google** 선택 → **사용 설정** 켜기
3. 프로젝트 지원 이메일을 고르고 **저장**

이때 OAuth 클라이언트가 자동으로 만들어집니다. 여기서 보이는
**웹 SDK 구성 → 웹 클라이언트 ID** 값은 나중에 필요할 수 있으니 위치만 기억해 두세요.

---

## 3. Realtime Database 만들기 ← 순서 중요

1. 왼쪽 메뉴 **빌드 → Realtime Database** → **데이터베이스 만들기**
2. 위치: **싱가포르 (asia-southeast1)** — 한국에서 가장 가깝습니다.
3. 보안 규칙: **잠금 모드로 시작** 선택 (다음 단계에서 규칙을 직접 넣습니다)

> Firestore가 아니라 **Realtime Database** 입니다. 위젯이 값을 훨씬 단순하게 읽을 수 있어서
> 이 앱에는 RTDB가 맞습니다.

---

## 4. 보안 규칙 넣기

**Realtime Database → 규칙** 탭에서 내용을 전부 지우고, 저장소의
[`database.rules.json`](../database.rules.json) 내용을 그대로 붙여 넣은 뒤 **게시**를 누릅니다.

이 규칙은 이렇게 동작합니다.

- 로그인한 사람은 **자기 UID 아래 데이터만** 읽고 쓸 수 있습니다.
- 로그인하지 않으면 아무것도 읽을 수 없습니다.
- 글은 최대 20,000자, 정해진 필드 외에는 저장되지 않습니다.

---

## 5. 웹 앱 등록하고 설정값 붙여 넣기

1. **프로젝트 설정(톱니바퀴) → 일반** → 하단 **내 앱** → **웹(`</>`)** 아이콘 클릭
2. 앱 닉네임: `post-it-web` → **앱 등록**
3. 화면에 나오는 `firebaseConfig` 객체의 값들을 복사
4. 저장소의 `js/firebase-config.js` 를 열어 붙여 넣습니다.

```js
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "post-it-xxxxx.firebaseapp.com",
  databaseURL: "https://post-it-xxxxx-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "post-it-xxxxx",
  storageBucket: "post-it-xxxxx.firebasestorage.app",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:abcdef"
};
```

> **이 값들은 비밀이 아닙니다.** 공개 저장소에 그대로 올려도 됩니다.
> Firebase의 apiKey는 비밀번호가 아니라 프로젝트 식별자이고, 실제 보안은 4단계의 규칙이 담당합니다.
> `databaseURL` 이 비어 있으면 3단계를 건너뛴 것이니 돌아가서 데이터베이스를 먼저 만드세요.

---

## 6. GitHub Pages 도메인 허용하기

**Authentication → 설정 → 승인된 도메인** 에서 **도메인 추가**를 눌러
`sehunyang.github.io` 를 추가합니다.

이걸 빠뜨리면 배포된 웹앱에서 Google 로그인 팝업이 `auth/unauthorized-domain` 으로 실패합니다.
(로컬 테스트용 `localhost` 는 기본으로 들어 있습니다.)

---

## 7. 안드로이드 앱 등록하기

1. **프로젝트 설정 → 일반 → 내 앱** → **Android** 아이콘 클릭
2. **Android 패키지 이름**: `kr.ai.shy.postit` ← 정확히 이대로 입력해야 합니다.
3. **디버그 서명 인증서 SHA-1**: 아래 값을 입력합니다.

   ```
   D8:35:66:2D:67:E0:A8:C3:60:15:66:7A:82:6D:B6:67:70:FC:14:31
   ```

   > 이 값은 이 PC의 `~/.android/debug.keystore` 에서 뽑은 것입니다.
   > 직접 다시 확인하려면:
   > ```
   > keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
   > ```
   > SHA-1 을 넣지 않으면 안드로이드에서 **Google 로그인이 반드시 실패합니다.**

4. **google-services.json 다운로드** → 파일을 `android/app/google-services.json` 에 넣습니다.
5. 나머지 안내(Gradle 설정)는 **이미 되어 있으니 그냥 넘기면** 됩니다.

> SHA-1을 나중에 추가했다면 **google-services.json을 반드시 다시 내려받아** 교체하세요.

---

## 8. 안드로이드 앱 빌드하고 폰에 설치하기

프로젝트 폴더에서:

```bash
cd android
./gradlew assembleDebug
```

만들어진 APK: `android/app/build/outputs/apk/debug/app-debug.apk`

폰에 넣는 방법 두 가지 중 편한 쪽을 고르세요.

**USB (권장)**
1. 폰에서 **설정 → 휴대전화 정보 → 소프트웨어 정보 → 빌드번호**를 7번 눌러 개발자 모드 켜기
2. **설정 → 개발자 옵션 → USB 디버깅** 켜기
3. USB로 연결한 뒤:
   ```bash
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   ```

**파일 전송**
APK를 카카오톡 나에게 보내기·구글 드라이브 등으로 폰에 옮긴 뒤 눌러서 설치합니다.
"출처를 알 수 없는 앱 설치"를 한 번 허용해 주어야 합니다.

---

## 9. 위젯 올리기

1. 폰에서 **Post-it** 앱을 열고 **Google 계정으로 시작하기** → 5단계에서 쓴 것과 **같은 계정**으로 로그인
2. 홈 화면 빈 곳을 길게 누르기 → **위젯** → **Post-it** → 홈 화면으로 끌어다 놓기
3. 웹앱에서 글을 하나 저장하고 **위젯에 고정**을 누른 뒤, 위젯의 새로 고침 아이콘을 눌러 보세요.

---

## 10. GitHub Pages 배포

저장소를 만들고 올린 뒤:

**Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**

1~2분 뒤 <https://sehunyang.github.io/post-it/> 에서 열립니다.

> `shy.ai.kr` 처럼 직접 쓰는 도메인이 있으면 `post-it.shy.ai.kr` 같은 서브도메인을
> CNAME으로 연결할 수도 있습니다. 그 경우 6단계의 승인된 도메인에 그 주소도 추가하세요.

---

## 문제가 생기면

| 증상 | 원인과 해결 |
|---|---|
| 웹앱에 "Firebase 설정이 아직 비어 있습니다" | 5단계를 안 했습니다. `js/firebase-config.js` 를 채우세요. |
| 로그인 팝업이 `auth/unauthorized-domain` 으로 실패 | 6단계를 안 했습니다. 승인된 도메인에 주소를 추가하세요. |
| 앱 실행 시 "Firebase 설정이 없습니다" 대화상자 | `android/app/google-services.json` 이 없습니다. 7단계를 하세요. |
| 안드로이드에서 로그인만 실패 | SHA-1 미등록이거나, SHA-1 등록 후 google-services.json 을 다시 안 받았습니다. |
| 웹앱에서 "읽기 실패: permission-denied" | 4단계 규칙을 게시하지 않았습니다. |
| 위젯 내용이 오래됨 | 정상입니다. 아래 "위젯이 갱신되는 시점"을 보세요. |

### 위젯이 갱신되는 시점

무료 티어에는 서버에서 폰으로 실시간 푸시를 보내는 수단이 없어서(그건 Cloud Functions =
유료 Blaze 요금제가 필요합니다), 위젯에 **보이는 글자**는 다음 시점에 갱신됩니다.

- 약 15~30분마다 자동으로
- 위젯의 새로 고침 아이콘을 눌렀을 때
- 앱을 열었을 때

다만 **위젯을 눌러 복사되는 내용은 언제나 최신입니다.** 누르는 순간 서버에서 다시 받아온 뒤
클립보드에 넣기 때문입니다. 화면에 옛날 글이 보여도 복사되는 건 지금 고정해 둔 글입니다.
