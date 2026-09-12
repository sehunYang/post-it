# 설정 가이드 (소유자용)

이 문서는 **Post-it 을 자기 Firebase 프로젝트로 처음 만드는 사람**을 위한 것입니다.
그냥 쓰려는 분은 [README](../README.md) 대로 <https://shy.ai.kr/post-it/> 에서 로그인하면 됩니다.

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
- 소유자 UID(규칙 안의 `PKfix…` 값)는 글 하나 20,000자, 그 외 계정은 5,000자까지. 정해진 필드 외에는 저장되지 않습니다.
- 자기 프로젝트로 만든다면 규칙 안의 소유자 UID 를 본인 UID 로 바꾸세요(Authentication → 사용자 탭에 보입니다).

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
`shy.ai.kr` 을 추가합니다.

이 저장소의 웹앱은 계정에 걸린 커스텀 도메인 덕분에
`sehunyang.github.io/post-it/` 이 아니라 **<https://shy.ai.kr/post-it/>** 로 열립니다.
포트폴리오와 같은 도메인이라, 승인해야 할 도메인도 `shy.ai.kr` 하나입니다.

이걸 빠뜨리면 배포된 웹앱에서 Google 로그인 팝업이 `auth/unauthorized-domain` 으로 실패합니다.
(로컬 테스트용 `localhost` 는 기본으로 들어 있습니다.)

---

## 7. 안드로이드 앱 등록하기

1. **프로젝트 설정 → 일반 → 내 앱** → **Android** 아이콘 클릭
2. **Android 패키지 이름**: `kr.ai.shy.postit` ← 정확히 이대로 입력해야 합니다.
3. **서명 인증서 SHA-1**: 앱을 서명하는 키의 SHA-1 을 넣습니다. 앱 등록 뒤에도
   프로젝트 설정 → 내 앱 → 디지털 지문 추가 로 더 넣을 수 있습니다. 두 개를 넣어 두세요.

   - 배포용 릴리스 키 (`android/keystore/post-it-release.jks`, [RELEASE.md](RELEASE.md) 참고):
     ```
     0C:E5:20:29:62:E1:1E:D8:37:5D:3C:E6:E2:72:0C:9F:0C:09:9C:7D
     ```
   - 이 PC 의 디버그 키 (`./gradlew assembleDebug` 로 직접 설치해 볼 때):
     ```
     D8:35:66:2D:67:E0:A8:C3:60:15:66:7A:82:6D:B6:67:70:FC:14:31
     ```

   > 디버그 키 값을 다시 확인하려면:
   > ```
   > keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
   > ```
   > 설치된 APK 의 서명 키 SHA-1 이 등록돼 있지 않으면 안드로이드에서 **Google 로그인이 반드시 실패합니다.**

4. **google-services.json 다운로드** → 파일을 `android/app/google-services.json` 에 넣습니다.
5. 나머지 안내(Gradle 설정)는 **이미 되어 있으니 그냥 넘기면** 됩니다.

> SHA-1 은 나중에 추가해도 바로 적용됩니다(로그인이 웹 클라이언트 ID 를 쓰므로 google-services.json 을 다시 받을 필요는 없습니다).

---

## 8. 안드로이드 앱 빌드하기

```bash
cd android
./gradlew assembleDebug      # → app/build/outputs/apk/debug/app-debug.apk (디버그 키 서명)
./gradlew assembleRelease    # → app/build/outputs/apk/release/app-release.apk (릴리스 키 서명)
```

릴리스 빌드는 `android/keystore.properties` 가 있을 때만 릴리스 키로 서명하고, 없으면 디버그 키를 씁니다.
릴리스 키를 만들고 Releases 에 올리는 순서는 [RELEASE.md](RELEASE.md) 에 있습니다.

---

## 9. 폰에 설치하고 위젯 올리기

교사들과 같은 길을 쓰면 됩니다. <https://shy.ai.kr/post-it/install/> 을 폰에서 열어 APK 를 받아 설치하고,
앱에서 **Google 계정으로 시작하기** → 5단계와 **같은 계정**으로 로그인 → **홈 화면에 위젯 추가**.

직접 빌드한 APK 를 넣고 싶으면 USB 디버깅을 켠 뒤 `adb install -r <apk>` 로 넣거나,
파일을 폰으로 옮겨 눌러 설치합니다.

---

## 10. GitHub Pages 배포

저장소를 만들고 올린 뒤:

**Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**

1~2분 뒤 **<https://shy.ai.kr/post-it/>** 에서 열립니다.

> 이미 설정을 마쳐 두었습니다. 저장소에 push 하면 자동으로 다시 배포됩니다.

---

## 문제가 생기면

| 증상 | 원인과 해결 |
|---|---|
| 웹앱에 "Firebase 설정이 아직 비어 있습니다" | 5단계를 안 했습니다. `js/firebase-config.js` 를 채우세요. |
| 로그인 팝업이 `auth/unauthorized-domain` 으로 실패 | 6단계를 안 했습니다. 승인된 도메인에 `shy.ai.kr` 을 추가하세요. |
| 앱 실행 시 "Firebase 설정이 없습니다" 대화상자 | `android/app/google-services.json` 이 없습니다. 7단계를 하세요. |
| 안드로이드에서 로그인만 실패 | 설치된 APK 를 서명한 키의 SHA-1 이 7단계에 등록되지 않았습니다. |
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
