# Goals to Today 디자인 QA

## 기준 소스

- Claude Design: `Goals_to_Today_Product_Redesign.dc.html`
- URL: https://claude.ai/design/p/f3f1e558-be1a-4ba2-b9a3-d9e323cc2cf4?file=Goals_to_Today_Product_Redesign.dc.html
- 원본 캡처: `docs/screenshots/design-reference/claude-*.png`
- 적용 화면: 랜딩, 로그인, 오늘, 주간 계획, 목표, 회고, 온보딩

## 구현 근거

- 랜딩: `src/screens/LandingScreen.tsx`, `src/landing.css`
- 공통 계획 흐름: `src/components/AppShell.tsx`
- 로그인: `src/auth/AuthProvider.tsx`
- 오늘 실행: `src/screens/TodayScreen.tsx`
- 주간 회고: `src/screens/ReviewScreen.tsx`
- 공통 반응형 스타일: `src/styles.css`

## 비교 조건

- 데스크톱 상태: 활성 계획과 현실적인 데모 작업이 있는 상태
- 데스크톱 CSS viewport: 1440 × 1000
- 모바일 상태: 동일한 계획과 작업, 실행 타이머 종료 상태
- 모바일 CSS viewport: 431 × 920, 비교 이미지는 430 × 920으로 정규화
- Chrome viewport override의 DPR 0.75 때문에 원본 브라우저 캡처는 1920 × 1333 또는 573 × 1227로 생성됐고, 비교 전에 기준 크기로 리샘플링함
- Claude 프레젠테이션의 상단 화면 선택 도구는 제품 UI가 아니므로 비교 대상에서 제외함

## 같은 입력에서의 시각 비교

- 랜딩: `docs/screenshots/design-qa/compare-landing-desktop.png`
- 오늘 데스크톱: `docs/screenshots/design-qa/compare-today-desktop.png`
- 목표: `docs/screenshots/design-qa/compare-goals-desktop.png`
- 회고: `docs/screenshots/design-qa/compare-review-desktop.png`
- 오늘 모바일: `docs/screenshots/design-qa/compare-today-mobile.png`

각 비교 파일은 왼쪽에 Claude 원본, 오른쪽에 실제 React 구현을 같은 화면 크기로 배치했다.

## 수정 이력

1. P1 — 모바일 첫 작업의 버튼이 좁고 다음 시간보다 나머지 작업이 먼저 보였음.
   - 첫 작업 CTA를 전체 너비로 변경.
   - 시각 순서를 `첫 작업 → 바로 이어갈 시간 → 나머지 Top 3 → 빠른 메모`로 변경.
2. P2 — 회고 단계가 5개인데 헤더에 4단계로 표시됐음.
   - 헤더 안내를 5단계로 수정.
3. P2 — 긴 타임라인과 세부 기록이 오늘의 핵심 행동을 밀어냈음.
   - 타임라인과 수동 기록을 기본 접힘 상태로 변경.
4. P2 — 목표의 6열 표는 모바일과 빠른 스캔에 불리했음.
   - 결과별 2열 카드와 모바일 1열 카드로 변경.

## 기능과 접근성 확인

- 랜딩 CTA, 앱 내 주 메뉴, 계획 여정 링크, 타이머 시작·종료, 회고 이월 결정 링크를 실제 Chrome에서 확인함.
- 핵심 버튼은 모바일에서 최소 44px 이상이며, 내비게이션과 접힘 영역에 접근 가능한 이름을 유지함.
- OIDC 로그인 계약은 변경하지 않았고 Claude 시안의 비회원 진입은 백엔드 계약이 없어 구현하지 않음.
- 시각 QA용 API는 인증만 응답하고 planner 동기화는 의도적으로 503을 반환하므로 `서버 연결 실패` 상태가 캡처에 표시됨. 렌더링 오류는 관찰되지 않았고 프로덕션 빌드와 테스트로 별도 검증함.

## 남은 차이

- Claude 원본은 개념 시안용 데이터와 화면 선택 도구를 포함하며, 실제 앱은 기존 저장·동기화·타이머 상태를 유지한다.
- 실제 앱은 데이터 손실 방지를 위해 모바일에서도 실행 현황과 3회 이월 경고를 숨기지 않는다.
- 이 차이는 기능 보존과 위험 안내를 위한 의도적인 차이이며 핵심 사용자 흐름을 막지 않는다.

## 최종 결과

passed
