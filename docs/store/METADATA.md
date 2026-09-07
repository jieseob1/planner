# Goals to Today 스토어 등록 초안

2026-09-07 기준. 계정·스토어 앱 레코드는 아직 없으며 이 문서는 제출용 초안이다. 출시 상태나 심사 통과를 의미하지 않는다. 릴리스 당일 각 콘솔의 요구사항을 다시 확인한다.

## 공통 메타데이터

| 항목 | 입력 초안 / 완료 조건 |
| --- | --- |
| 앱 이름 | Goals to Today |
| Bundle ID / package | `com.jieseob.planner` — 기존 ID 유지 |
| 기본 언어 | 한국어, 영어 설명은 실제 지원 언어에 맞춰 추가 |
| 카테고리 후보 | Productivity / 생산성 |
| 짧은 설명 후보 | 목표와 할 일, 일정을 오늘의 실행으로 연결하세요. |
| 웹사이트 | https://goalstotoday.com |
| 개인정보 URL 후보 | https://goalstotoday.com/privacy — 비로그인 접근·운영자·연락처·보관 기간 재검증 |
| 이용약관 URL 후보 | https://goalstotoday.com/terms — 비로그인 접근 재검증 |
| 지원 URL / 이메일 | 실제 운영자가 응답 가능한 채널을 확정하고 공개 페이지에서 확인한 뒤 입력 |
| 계정 삭제 웹 URL | 웹에서 삭제 요청을 시작할 수 있는 실제 URL 확정. 방침만 있는 페이지나 로그인이 필요한 앱 설치 안내만으로 대체하지 않음 |
| 저작권·판매자·연락처 | 개발자 계정의 실제 개인/법인 정보와 일치하도록 입력 |
| 연령 등급 / 광고 / 가격 / 국가 | 실제 기능 기준으로 설문 작성. 자동 추정값으로 제출하지 않음 |

상세 설명 초안:

> Goals to Today는 목표와 계획을 오늘 할 일로 연결하는 개인 플래너입니다. 할 일을 기록하고 일정에 배치하고, 하루의 실행을 돌아볼 수 있습니다. 목표가 없어도 할 일과 일정을 바로 시작할 수 있습니다. 지원되는 기능과 연동 범위는 앱에서 확인하세요.

실기기에서 검증하지 않은 푸시, 백그라운드 동작, 오프라인 동기화, 완전 자동화 또는 유료 기능을 홍보 문구에 추가하지 않는다.

## 스크린샷·그래픽

현재 네이티브 아이콘과 splash에는 기존 초록·노랑 브랜드 자산이 들어 있다. iOS 아이콘은 1024×1024 PNG이며 Android에는 각 밀도 아이콘과 adaptive icon이 있다. 런처 마스킹·라이트/다크 화면·splash 전환을 실기기에서 확인한다. 기존 웹 QA 스크린샷을 네이티브 검증 증거로 간주하지 않는다.

- App Store: 실제 앱의 스크린샷 1–10장, JPEG/PNG, 투명도 없음. 예시 세트는 iPhone 6.9인치 1320×2868 세로, iPad 13인치 2064×2752 세로. 이 앱은 `TARGETED_DEVICE_FAMILY = "1,2"`이므로 iPad 세트도 준비한다. 허용 기종별 크기와 대체 규칙은 [Apple screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)에서 최종 확인한다.
- Google Play: 휴대전화 실제 화면 최소 2장, JPEG 또는 24-bit PNG, 한 변 320–3840px, 긴 변은 짧은 변의 두 배 이하. 1080×1920 세로 세트를 권장한다. 별도로 512×512 스토어 아이콘과 1024×500 feature graphic을 준비한다. [Google Play preview assets](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en).
- 두 플랫폼 모두 오늘 할 일 → 일정 배치 → 목표/계획 → 회고 화면을 실제 테스트 데이터로 촬영한다. 개인 이메일·일정·토큰은 포함하지 않는다. 빈 화면, 웹 브라우저 주소창, 동작하지 않는 기능, 미확정 가격은 넣지 않는다.

시뮬레이터 예시: 앱 실행 후 `xcrun simctl io booted screenshot screenshot.png`. Android 예시: `adb exec-out screencap -p > screenshot.png`. 스토어 크기를 맞추려고 늘리거나 가짜 UI를 합성하지 않는다.

## 심사자 메모 초안

- 앱 목적: 개인 목표·할 일·일정을 관리하고 하루 실행을 회고하는 플래너.
- 로그인: 전용 테스트 계정과 로그인 순서를 스토어의 비공개 review/app-access 필드에 제공. 운영자 계정이나 개인 계정 자격 증명은 사용하지 않는다.
- 로그인 성공/취소 후 앱으로 돌아오는 과정, 재로그인, 로그아웃, 계정 삭제 경로를 설명하고 검증 결과를 첨부한다.
- Google Calendar 등 선택 연동이 켜진 경우, 기본 앱 사용과 별개인 연동 흐름·권한·해제 방법을 설명한다. 메인 계정 로그인에 Google 등의 소셜 로그인을 제공한다면 Apple 4.8의 동등한 로그인 옵션 요건을 검토한다. 단순 캘린더 연동 자체와 소셜 계정 로그인을 혼동하지 않는다. [Apple review guidelines](https://developer.apple.com/app-store/review/guidelines/).
- 설치 앱에서 일정 조작·보안 저장·재진입 동작을 시연한다. Capacitor 빌드 성공만으로 최소 기능성 심사를 충족한다고 주장하지 않는다.

## 개인정보와 삭제 제출 전 확인

`ios/App/App/PrivacyInfo.xcprivacy`에는 이메일·사용자 ID·사용자 작성 콘텐츠·제품 상호작용을 계정에 연결된 앱 기능 데이터로, 추적은 하지 않는 것으로 선언했다. 설치된 SDK와 서버가 실제 수집하는 진단 정보·푸시 토큰·연동 데이터, 보관/삭제 방식과 다시 대조한 뒤 App Privacy와 Data safety를 작성한다. 매니페스트는 방침이나 스토어 설문을 자동 대체하지 않는다. SDK 추가/업데이트 시 required-reason API와 SDK 매니페스트를 다시 검토한다. [Capacitor privacy manifest](https://capacitorjs.com/docs/ios/privacy-manifest).

- Apple: 계정 생성 기능이 있는 앱은 앱 안에서 계정 삭제를 시작할 수 있어야 한다. 비활성화만 제공하면 삭제가 아니다. [Apple account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/).
- Google Play: 앱 내 경로와 앱 외 웹 삭제 요청 경로를 모두 확인하고 콘솔에 웹 URL을 입력한다. 삭제 대상·예외 보관 사유·기간을 공개한다. [Google account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en).
- 실제 삭제 검증에는 플래너 데이터, Keycloak 신원, 기기 푸시 토큰, Google OAuth 연결, 로컬 Keychain/Keystore, 백업 보관 정책을 포함한다. 일부 시스템 삭제가 지연되거나 보존된다면 사용자 안내와 설문에 반영한다.
- Apple의 암호화 수출 관련 질문은 HTTPS와 OS 보안 저장소 및 포함 SDK의 실제 암호화 사용을 검토해 답한다. 코드에서 면제 여부를 임의로 확정하지 않는다.
