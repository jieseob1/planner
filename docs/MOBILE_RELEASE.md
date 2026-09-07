# Goals to Today 모바일 빌드와 스토어 제출

현재 Apple Developer와 Google Play Console 계정은 없다. 계정 없이 실행하는 `Mobile build CI`와, 계정 개설 후 서명 자료를 넣어 실행하는 `Mobile store artifacts`를 구분한다. 어떤 workflow도 스토어 업로드·심사 요청·공개를 자동 실행하지 않는다.

## 지금 가능한 빌드

`.github/workflows/mobile-ci.yml`은 main push, PR, 수동 실행마다 실제 네이티브 컴파일을 수행한다. 결과는 실행 SHA가 붙은 GitHub Actions artifact로 14일 보관한다.

| 결과 | 툴체인 | 사용 범위 |
| --- | --- | --- |
| `app-debug.apk` | Node 24, JDK 21, Android SDK/target 36, 저장된 Gradle wrapper | Android 설치·디버깅. Android가 자동 생성한 디버그 키로 서명되며 스토어용 업로드 키는 필요 없음 |
| `GoalsToToday-simulator.app.zip` | macOS, 설치된 stable Xcode 26 이상, iOS simulator SDK 26 이상, Swift Package Manager | 압축 해제 후 iOS 시뮬레이터 설치. `CODE_SIGNING_ALLOWED=NO`; 실물 iPhone 설치·TestFlight용 IPA가 아님 |

설정 검사 `node scripts/verify-mobile-readiness.mjs`는 잘못된 버전·서명 누락·워크플로 변경 등의 부정 입력도 검사한다. 이 검사 성공은 APK/앱 컴파일이나 실제 로그인 성공을 대신하지 않는다. 빌드 증거는 각 GitHub 실행 로그와 artifact로 확인한다.

로컬 Android 재현:

```bash
npm ci
export VITE_AUTH_MODE=oidc
export VITE_API_BASE_URL=https://goalstotoday.com
export VITE_OIDC_AUTHORITY=https://goalstotoday.com/idp/realms/nowline
export VITE_OIDC_CLIENT_ID=nowline-mobile
export VITE_OIDC_SCOPE='openid profile email offline_access'
export VITE_OIDC_NATIVE_REDIRECT_URI=com.jieseob.planner://auth/callback
export VITE_OIDC_NATIVE_POST_LOGOUT_REDIRECT_URI=com.jieseob.planner://auth/logout
export VITE_NATIVE_PUSH_ENABLED=false
npm run build
npx cap sync android
cd android
# JAVA_HOME은 설치된 JDK 21, ANDROID_HOME은 설치된 Android SDK 경로로 지정
./gradlew --no-daemon assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

시뮬레이터 artifact는 해당 CPU 아키텍처를 지원하는 Xcode 환경에서 `xcrun simctl install booted App.app`, `xcrun simctl launch booted com.jieseob.planner`로 실행한다. 로컬 iOS 컴파일은 workflow의 `xcodebuild` 명령을 따른다. Xcode Command Line Tools만 설치된 Mac에서는 빌드할 수 없다. [Capacitor 8 환경 요건](https://capacitorjs.com/docs/getting-started/environment-setup).

## 인증·푸시 계약

- 앱 ID는 `com.jieseob.planner`, 사용자에게 보이는 이름은 `Goals to Today`로 유지한다. 앱에는 `dist`의 웹 자산을 패키징하며 원격 개발 서버 URL을 넣지 않는다.
- API: `https://goalstotoday.com`. OIDC authority: `https://goalstotoday.com/idp/realms/nowline`. 네이티브 전용 공개 client: `nowline-mobile`, Authorization Code + PKCE S256. 앱에 client secret을 넣지 않는다.
- 허용 redirect: `com.jieseob.planner://auth/callback`; logout: `com.jieseob.planner://auth/logout`. Keycloak은 정확한 URL만 허용한다. Android manifest는 scheme/host/path를 제한하며 iOS URL scheme과 SceneDelegate가 URL을 Capacitor에 전달한다. OS scheme 등록 자체는 OAuth state/PKCE 검증을 대신하지 않는다.
- Keycloak의 Web Origins에는 앱의 실제 WebView origin(`capacitor://localhost` 및 `https://localhost`)을 검증해 허용한다. API CORS도 해당 origin과 일치해야 한다. 웹 client `nowline-web`과 섞지 않는다.
- 현재 custom scheme 콜백에는 iOS Associated Domains나 Android Digital Asset Links가 필요하지 않다. 이후 HTTPS Universal/App Links로 바꾸면 도메인 연결 파일·entitlement·OAuth redirect를 함께 추가해야 한다.
- CI는 `VITE_NATIVE_PUSH_ENABLED=false`. 수동 release도 기본 false다. Android FCM 설정은 true일 때만 필수이며 package ID도 검사한다. iOS는 기존 APNs entitlement와 등록 callback을 유지하므로 signed profile에 production Push Notifications capability가 필요하다. 실제 푸시는 FCM/APNs 서버 자격 증명·사용자 opt-in·기기 토큰 등록·전달/탭 검증이 끝난 뒤 true로 켠다. 빌드만으로 푸시 전달을 보장하지 않는다. [Capacitor Push Notifications](https://capacitorjs.com/docs/apis/push-notifications).

## 개발자 계정 개설 후 준비

1. 실제 개인/법인 주체를 선택하고 Apple Developer Program과 Google Play Console 등록·신원 확인을 완료한다. 브랜드명과 법적 판매자명이 같다고 가정하지 않는다. Apple은 App Store Connect 앱과 명시적 App ID `com.jieseob.planner`, Android는 동일 package의 Play 앱을 만든다. 이미 다른 계정에 ID가 등록되어 있으면 충돌을 먼저 해결한다.
2. Google Play App Signing을 설정하고 별도 upload keystore를 생성·안전하게 백업한다. 키·비밀번호를 저장소나 artifact에 넣지 않는다. 새 개인 Play 계정은 production access 전 최소 12명 연속 14일 closed test 및 신청 단계가 적용된다. 내부 테스트만으로 대신할 수 없다. [Google 신규 개인 계정 테스트](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en).
3. Apple Distribution 인증서를 개인 키와 함께 암호화된 `.p12`로 내보낸다. Push Notifications capability가 켜진 명시적 App ID의 App Store Connect provisioning profile을 생성한다. 개발용·Ad Hoc·Enterprise profile은 사용하지 않는다. [Apple App Store profile](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile/), [수동 서명](https://help.apple.com/xcode/mac/current/en.lproj/devcac6ab5b3.html).
4. GitHub Environment `mobile-production`을 만들고 main만 배포 가능하게 제한한다. 운영자가 서명 자료를 추가하고 필요에 따라 required reviewers를 설정한다. workflow는 main 조건을 먼저 검사한다. App Store Connect API key는 artifact 생성에 필요하지 않다.

`mobile-production` secrets:

| 플랫폼 | Secret | 내용 |
| --- | --- | --- |
| Android | `ANDROID_KEYSTORE_BASE64` | upload keystore의 base64 |
| Android | `ANDROID_KEYSTORE_PASSWORD` | keystore 암호 |
| Android | `ANDROID_KEY_ALIAS` | upload key alias |
| Android | `ANDROID_KEY_PASSWORD` | upload key 암호 |
| Android 선택 | `GOOGLE_SERVICES_JSON_BASE64` | FCM이 준비되고 `native_push=true`일 때만 필요; `com.jieseob.planner` 등록 JSON |
| iOS | `APPLE_TEAM_ID` | 10자리 팀 ID |
| iOS | `APPLE_DISTRIBUTION_P12_BASE64` | 인증서 + 개인 키를 포함한 p12의 base64 |
| iOS | `APPLE_DISTRIBUTION_P12_PASSWORD` | p12 내보내기 암호, 빈 암호 사용 안 함 |
| iOS | `APPLE_PROVISIONING_PROFILE_BASE64` | 해당 팀/앱의 유효한 App Store profile base64 |

한 플랫폼만 준비되면 `platform=android` 또는 `ios`로 실행한다. 필요한 secret 이름만 오류에 표시하고 값은 출력하지 않는다. 임시 키·profile·keychain은 성공/실패와 관계없이 cleanup 단계에서 제거한다. 실행 취소나 runner 손실 시에는 hosted runner의 폐기 경계도 적용된다.

## 수동 서명과 제출

1. main의 `Mobile build CI`가 성공한 SHA와 artifact를 확인한다. 스토어와 [메타데이터 체크리스트](store/METADATA.md)를 채우고 실기기 QA를 마친다.
2. `Mobile store artifacts`에서 `platform`, `version`, `build_number`, `native_push`를 입력한다. `version`은 세 정수 `MAJOR.MINOR.PATCH`(major 0–9999, minor/patch 0–99, 선행 0 없음). `build_number`는 1–9999 중 두 스토어에서 쓰지 않은 증가 번호다. 양 플랫폼의 보수적인 공통 형식이며 GitHub run number를 재사용하지 않는다. workflow는 외부 콘솔 접근 권한이 없어 이전 업로드 번호와의 비교는 운영자가 해야 한다. 재실행으로 재업로드할 때도 새 번호를 사용한다.
3. Android는 release minify/shrink 후 업로드 키로 서명한 AAB와 mapping 파일, iOS는 배포 인증서로 서명한 IPA와 dSYM을 남긴다. profile은 bundle/team/기한/배포 유형/APNs를 검사하고 바이너리 서명 검사도 실행한다. artifact 성공이 store-side validation 성공을 의미하지 않는다.
4. Android AAB는 Play Console 내부 테스트 → 필요 closed test → production access → 단계적 배포 순서로 업로드한다. 앱 접근 정보, Data safety, 콘텐츠 등급, 삭제 URL, 대상 국가, 가격을 실제 상태로 입력한다.
5. iOS IPA는 Transporter 또는 Xcode/App Store Connect의 공식 업로드 경로로 전송한다. 처리·export compliance 완료 후 TestFlight 설치 검증, review 계정/메모·App Privacy·연령 등급·스크린샷을 채우고 심사를 제출한다. 첫 심사 결과를 확인한 뒤 공개 방식을 선택한다.

2026-09-07 확인: iOS 제출에는 Xcode 26 이상/iOS 26 SDK 이상이 필요하고, 일반 Android 새 앱·업데이트는 target API 36 이상이 필요하다. 저장소는 해당 기준을 사용한다. 제출일의 요건 변경은 [Apple upcoming requirements](https://developer.apple.com/news/upcoming-requirements/)와 [Google target API requirements](https://developer.android.com/google/play/requirements/target-sdk)에서 재확인한다.

## 제출 전 실기기 완료 조건

- [ ] Android와 iPhone에서 설치·초기 실행·로그인·취소·실패 후 복구·앱이 종료된 상태의 콜백·로그아웃 검증.
- [ ] 토큰 갱신·앱 재시작·Keychain/Keystore 저장·계정 전환과 알림 등록 해지 검증.
- [ ] 할 일/일정/목표/회고, 오프라인 재연결과 충돌, 작은 화면·safe area·키보드·뒤로 가기 검증.
- [ ] iPad 레이아웃과 회전, Android adaptive icon, splash, 알림 권한 거부 상태 검증.
- [ ] 선택 푸시를 켜면 foreground/background/종료 상태 전달과 탭 이동을 실제 FCM/APNs로 검증.
- [ ] Google 연결/해제·내보내기·앱 내 계정 삭제·앱 외 웹 삭제 요청, 관련 신원/데이터/토큰 처리 검증.
- [ ] 개인정보 방침·스토어 설문·SDK privacy manifest·지원 채널·review 계정·스크린샷 완료.

개발자 계정, 서명 자료, 실기기/테스터, 스토어 입력·검증·심사는 외부 완료 조건이다. 이 문서와 CI를 추가한 것만으로 제출·승인·게시 완료로 표시하지 않는다.
