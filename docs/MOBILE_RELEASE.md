# Mobile release checklist

## 공통

- [ ] 실제 HTTPS API origin과 OIDC client를 주입해 `npm run cap:sync`
- [ ] `com.jieseob.planner://auth/callback` deep link를 로그인·취소·오류·logout 각각 검증
- [ ] Keychain/Keystore에만 OIDC state가 저장되고 앱 재시작·토큰 갱신이 동작
- [ ] 오프라인 편집 → 재연결 → ETag 충돌 병합을 실기기 두 대에서 검증
- [ ] Google 연결/해제, 데이터 export, fresh-login 계정 삭제 검증
- [ ] 앱 아이콘·splash·권한 문구·개인정보 화면 확인

## Android

- [ ] Play application ID, versionCode, versionName 확정
- [ ] 업로드 keystore와 Play App Signing 백업/복구 책임자 지정
- [ ] `google-services.json`, FCM APNs-independent push 실제 전달
- [ ] release AAB minify 결과와 baseline/startup 확인
- [ ] Data safety form가 `PrivacyInfo.xcprivacy`와 웹 방침에 일치
- [ ] 내부 테스트 트랙에서 로그인 callback, notification tap route, 계정 삭제 확인

## iOS

- [ ] Apple Team, App ID, provisioning, APNs capability와 production entitlement 확인
- [ ] App Store Connect privacy nutrition label이 `PrivacyInfo.xcprivacy`와 일치
- [ ] TestFlight에서 universal/custom link, foreground/background push, 삭제 후 재가입 확인
- [ ] Sign in 정책상 제3자 소셜 로그인 제공 시 Sign in with Apple 의무 여부 검토
- [ ] review note에 테스트 계정과 Google Calendar 연동 흐름 제공

수동 workflow `.github/workflows/mobile-release.yml`은 서명된 AAB와 IPA를 artifact로 만들지만 스토어 제출·심사까지 자동 실행하지 않습니다.

