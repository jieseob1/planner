# Nowline 사용성 평가 기준

이 문서는 Nowline의 화면을 취향이 아니라 **관찰 가능한 기준**으로 점검하기 위한 체크리스트다. W3C WCAG 2.2는 접근성 성공 기준, Nielsen Norman Group(NN/g)은 정량 합격선이 없는 휴리스틱, Apple·Android 지침은 각 플랫폼의 권장값으로 구분한다.

기준 확인일: 2026-08-31

> 단위 주의: `CSS px`, Apple의 `pt`, Android의 `dp`는 같은 단위가 아니다. 아래 수치를 서로 변환한 값처럼 설명하지 않는다.

## 1. W3C WCAG 2.2

적합성의 원문 기준은 [WCAG 2.2 W3C Recommendation](https://www.w3.org/TR/WCAG22/)이다. 아래 링크는 각 성공 기준의 공식 Understanding 문서이며, 적용 의도를 설명하는 참고 문서이지 권고안 본문 자체는 아니다.

| 기준 | 출처에서 확인한 규칙 | Nowline에서 확인할 질문 |
| --- | --- | --- |
| 2.4.7 Focus Visible (AA) | 키보드로 조작 가능한 UI에는 현재 포커스를 볼 수 있는 작동 방식이 있어야 하며, 포커스 표시는 시간 제한으로 사라지면 안 된다. [W3C 설명](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html) | `/today`, `/planner`, `/goals`, `/review`, `/onboarding`과 열린 시트·다이얼로그를 `Tab`/`Shift+Tab`으로 순회할 때 매 순간 포커스 위치가 보이는가? |
| 2.4.11 Focus Not Obscured — Minimum (AA) | 작성자가 만든 콘텐츠 때문에 포커스를 받은 컴포넌트가 **완전히 가려지면 안 된다**. 일부 가림까지 금지하는 기준은 AAA이므로 여기서 과장하지 않는다. [W3C 설명](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) | 고정 상단 바, 모바일 하단 탭, FAB, 토스트, 작업 배치 시트가 현재 포커스 대상을 완전히 덮는 경우가 없는가? `Esc` 등으로 가림을 해제할 수 있는가? |
| 2.5.8 Target Size — Minimum (AA) | 포인터 입력 대상은 원칙적으로 **24×24 CSS px 이상**이다. 작은 대상도 간격·동등 기능·문장 안 링크·사용자 에이전트 제어·필수 표현 예외 중 하나를 실제로 충족하면 통과할 수 있다. [W3C 설명](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | 모든 버튼·탭·아이콘·드래그 대체 조작의 실제 클릭 영역을 `getBoundingClientRect()`로 재었는가? 24 CSS px 미만이면 적용 가능한 예외와 주변 대상 간 충돌 여부를 증명했는가? |
| 3.3.2 Labels or Instructions (A) | 사용자 입력이 필요하면 무엇을 입력해야 하는지 알 수 있는 라벨 또는 지침을 제공해야 한다. [W3C 설명](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html) | 빠른 수집, 완료 근거, 결과 갱신, 회고 입력에 항상 보이는 라벨과 필요한 형식·필수 여부가 있는가? Nowline 점검에서는 사라지는 placeholder만으로 라벨을 대신하지 않는가? |
| 4.1.2 Name, Role, Value (A) | 모든 UI 컴포넌트의 이름과 역할을 프로그램이 판별할 수 있어야 하고, 사용자가 바꾸는 상태·속성·값과 그 변경을 보조 기술이 알 수 있어야 한다. [W3C 설명](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html) | 아이콘 전용 버튼, 현재 탭, 토글, 진행률, 열린/닫힌 시트에 접근 가능한 이름·역할·상태가 있으며 접근성 트리에서 의미가 구분되는가? |
| 4.1.3 Status Messages (AA) | 포커스를 옮기지 않는 성공·결과·대기·진행·오류 상태 메시지는 역할이나 속성으로 프로그램이 판별할 수 있어야 한다. 모든 동적 콘텐츠가 상태 메시지라는 뜻은 아니다. [W3C 설명](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) | 로컬 저장, 타이머 시작·정지, 작업 배치·완료, 검증 실패가 화면에 보이면서 적절한 `status`/`alert` live region으로도 전달되는가? 불필요하게 포커스를 빼앗지 않는가? |
| 3.3.1 Error Identification (A) | 자동 감지한 입력 오류는 오류가 난 항목을 식별하고 무엇이 잘못됐는지 **텍스트로** 설명해야 한다. 색상만으로 표시하면 부족하다. [W3C 설명](https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html) | 빈 값·잘못된 날짜·허용 범위 밖 값·저장 실패 시 해당 필드와 이유가 텍스트로 연결되는가? 사용자가 다음에 무엇을 고쳐야 하는지 이해할 수 있는가? |

## 2. Nielsen Norman Group 휴리스틱

[NN/g의 10가지 사용성 휴리스틱](https://www.nngroup.com/articles/ten-usability-heuristics/)은 표준 적합성이나 숫자 합격선이 아니라 일반적인 설계 원칙이다. Nowline에는 다음 항목을 우선 적용한다.

| 휴리스틱 | Nowline에서 확인할 질문 |
| --- | --- |
| 시스템 상태 가시성 | 클릭 직후 타이머, 로컬 저장, 완료, 배치 결과와 다음 가능한 행동이 합리적인 시간 안에 보이는가? 네트워크 동기화가 없는 현재 상태를 서버 저장처럼 오해하게 하지 않는가? |
| 사용자 통제와 자유 | 열린 시트·온보딩을 취소하거나 나갈 수 있고, 타이머를 멈출 수 있는가? 되돌리기 어려운 완료·이동·삭제에는 취소, 되돌리기 또는 사전 확인이 있는가? |
| 일관성과 표준 | Today·Planner·Goals·Review에서 같은 개념에 같은 용어·아이콘·상태 색·조작 방식을 쓰는가? 버튼처럼 보이는 요소는 실제로 작동하는가? |
| 오류 예방 | 시간 블록 충돌, 필수 입력 누락, 의도치 않은 중복 완료처럼 예상 가능한 실수를 실행 전에 막거나 명확히 확인하는가? |
| 회상보다 인식 | 작업을 실행·배치·회고할 때 상위 목표, 분기 결과, 예상 시간과 선택지를 화면에서 확인할 수 있어 다른 화면의 내용을 외울 필요가 없는가? |
| 미학적이고 절제된 설계 | 각 화면의 주 행동이 하나의 분명한 시각적 우선순위를 가지며, 현재 결정에 필요 없는 카드·수치·설명이 핵심 흐름을 밀어내지 않는가? |
| 오류 인식·진단·복구 지원 | 오류 문구가 내부 코드 대신 쉬운 말로 원인과 복구 행동을 알려 주고, 사용자가 입력을 잃지 않은 채 다시 시도할 수 있는가? |

## 3. 모바일 터치 대상 기준

- Apple HIG의 현재 Accessibility 표는 iOS·iPadOS의 **기본 컨트롤 크기 44×44 pt**, **최소 컨트롤 크기 28×28 pt**를 구분하고 컨트롤 간 충분한 간격도 요구한다. Buttons 지침은 일반적인 버튼 hit region을 최소 44×44 pt로 설명한다. [Apple HIG Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), [Apple HIG Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)
- Android Developers는 터치 인터페이스의 각 상호작용 요소에 **최소 48×48 dp의 포커스 가능 영역 또는 터치 대상**을 권장한다. 정밀 포인터 입력은 더 작을 수 있다고 별도로 명시한다. [Android 접근성 지침](https://developer.android.com/guide/topics/ui/accessibility/apps#touch-targets)
- Nowline 웹/PWA의 내부 출시 기준은 모바일 주요 조작의 실제 hit area를 **44×44 CSS px 이상**으로 정한다. 이는 WCAG의 24 CSS px 합격선보다 엄격한 제품 기준이지만 Apple의 `pt` 또는 Android의 `dp`와 동일하다고 주장하지 않는다.

관찰 질문:

1. 모바일 뷰포트에서 하단 탭, FAB, 아이콘 버튼, 닫기, 체크, 타이머 조작의 실제 hit area가 각각 44×44 CSS px 이상인가?
2. 보이는 아이콘이 작더라도 padding을 포함한 클릭 영역이 충분하고, 인접 대상의 hit area가 겹치지 않는가?
3. Capacitor iOS·Android 실제 기기에서 hit area와 오작동 빈도를 다시 확인했는가? Android는 48×48 dp 권장값에 대한 별도 기기 검증이 필요한가?

## 4. 판정 방법과 한계

- 각 질문은 `PASS`, `FAIL`, `확인 불가` 중 하나와 화면·뷰포트·조작·측정값을 함께 기록한다.
- 데스크톱은 키보드 순회와 포커스 가림, 모바일은 터치 영역과 한 손 조작, 두 환경 모두 핵심 흐름의 상태 피드백과 오류 복구를 확인한다.
- 자동 검사만으로 키보드 흐름, 메시지 이해 가능성, 실제 터치 정확도를 확정하지 않는다. 브라우저 관찰과 실제 기기 검증을 병행한다.
- 이 체크리스트를 통과해도 전체 WCAG 2.2 적합성을 인증한 것은 아니다. 현재 범위는 Nowline의 핵심 화면과 흐름에 대한 출시 전 사용성 감사다.
