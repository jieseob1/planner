# 시작 15분 전 알림: 동작과 베타 검증

2026-09-08 변경. 코드/격리 MySQL 테스트와 실제 계정·휴대폰 전달은 별도 완료 기준이다.

## 사용자가 알아야 할 내용

- 이 앱에서 만든 시간 블록은 새 계정 설정 기준 **15분 전** 알림을 사용한다. 기존 사용자의 10분 등 저장된 선택은 유지한다. 설정에서 원하는 분으로 변경한다.
- 기기에서 알림을 허용하고 해당 계정으로 기기를 등록해야 한다. 기기 등록/권한이 없으면 알림은 전송되지 않는다.
- 내일 00:05 일정은 오늘 23:50에, 24시간 전 설정이면 전날 같은 시각에 알린다. 날짜 없는 옛 데이터는 추측해서 알리지 않는다.
- 시간 변경·삭제·연결된 할 일 완료/취소 후에는 큐에 있던 이전 알림도 전송 직전에 검사해 건너뛴다. 일정의 최신 제목을 사용한다.
- 일정 알림의 이동 주소는 `/today?date=YYYY-MM-DD`로 해당 일정 날짜를 가리킨다. 다음 날 일정을 전날 알리더라도 날짜를 잃지 않는다.
- Google에서 가져온 `external` 일정은 **Google Calendar 쪽 알림 설정을 사용**한다. 이 앱이 같은 일정을 중복 푸시하지 않는다. Google 일정을 이 앱이 추가로 알리게 하는 별도 선택은 아직 제공하지 않는다.
- 네트워크와 OS 절전·집중 모드 때문에 휴대폰이 정확히 15분 전에 표시한다고 보장하지 않는다. 서버의 전달 요청 성공도 화면 표시 성공과 다르다. [FCM 전달 수명](https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-lifespan)

## 내부 정책

| 단계 | 적용 내용 |
| --- | --- |
| 생성 | 30초 주기. 사용자 IANA 시간대의 달력 시각을 UTC로 환산. 대상 시각 30초 전부터 120초 후까지 후보를 생성 |
| 큐 | `scheduled_for` 이전에는 claim 불가. `(user_id, deduplication_key)` 유일성 + MySQL `FOR UPDATE SKIP LOCKED`로 여러 워커의 중복 claim 방지 |
| 동일 일정 | 키는 `block:v2:<blockId>:<startEpochMillis>:<leadMinutes>`. 시간/알림분이 바뀌면 새 키; 제목만 바뀌면 같은 알림 |
| 발송 직전 | 현재 계정의 저장된 일정/할 일 상태/알림 설정을 다시 읽어 키와 예약 시각 비교. 만료·삭제·완료·취소·설정변경이면 `SKIPPED / reminder-no-longer-current` |
| 되돌리기 | 시간을 옮겼다가 되돌리면 위 사유로 건너뛴 미전달 알림만 다시 활성화. 이미 `DELIVERED`인 알림은 다시 보내지 않음 |
| 지연 | 예약 시각 120초 초과 또는 시작이 지난 사전 알림은 재시도하지 않음. 0분 설정은 시작 시각 알림으로 처리 |
| 전달 식별 | `nowline-<deliveryUUID>`를 Web Push tag 및 native adapter의 `deduplicationKey`로 사용. 서로 다른 일정이 `TIME_BLOCK` 하나로 합쳐지지 않음 |
| 공급자 보관 | Web Push TTL 120초. native adapter에 `ttlSeconds: 120` 전달; adapter가 FCM TTL/APNs 만료 시각에 반영해야 함 |

발송 직전 DB 확인과 외부 공급자 호출은 하나의 원자적 트랜잭션이 아니다. 확인 직후 변경된 일정이나 이미 공급자에게 접수된 알림을 회수한다고 주장하지 않는다. 발송 직후 프로세스 장애가 나면 재시도될 수 있으므로 native adapter는 **기기별 + deduplicationKey**로 중복 접수를 방어해야 한다. 현재 `DELIVERED`는 적어도 한 기기에 대한 공급자 접수 성공이며 모든 기기 도착을 보증하지 않는다.

서머타임 전환일에도 `startMinutes`는 자정 이후 경과 시간이 아니라 화면의 벽시계 시각이다. 존재하지 않는 시각은 Java 시간대 규칙으로 앞으로 보정하고 중복 시각은 앞선 오프셋을 사용한다. 해외 시간대 베타에서 실제 UI·기기 검증이 필요하다.

## 실제 연동 전에 필요한 설정

설정값은 Kubernetes Secret 등으로 주입하고 채팅/README/로그에 비밀 값을 붙이지 않는다.

- Google: `NOWLINE_GOOGLE_CLIENT_ID`, `NOWLINE_GOOGLE_CLIENT_SECRET`, 운영 도메인의 `NOWLINE_GOOGLE_REDIRECT_URI`, `NOWLINE_GOOGLE_WEBHOOK_URI`, 토큰 암호화 설정. OAuth 동의/공개 범위는 운영자가 Google 프로젝트에서 확인한다.
- Web Push: `NOWLINE_VAPID_PUBLIC_KEY`, `NOWLINE_VAPID_PRIVATE_KEY`, `NOWLINE_VAPID_SUBJECT`, 구독 암호화 설정. 브라우저/설치형 웹앱에서 권한 허용과 실제 수신 확인.
- Android/iOS: 현재 네이티브 전달 코드는 `NOWLINE_NATIVE_PUSH_DELIVERY_URI`와 `NOWLINE_NATIVE_PUSH_BEARER_TOKEN`으로 HTTPS adapter를 호출한다. **FCM/APNs 공급자 연결을 이것만으로 구현·설정 완료했다고 볼 수 없다.** adapter 구현/배포, Firebase/APNs 인증과 앱 서명, 기기 토큰 등록을 확인한다.
- Android 13 이상은 `POST_NOTIFICATIONS` 런타임 권한 허용/거부 시나리오가 필요하다. [Android 공식 권한 안내](https://developer.android.com/develop/ui/compose/notifications/notification-permission)
- iOS는 APNs 등록 토큰, provider 인증, 앱의 원격 알림 구성이 필요하다. [Apple 원격 알림 서버 안내](https://developer.apple.com/documentation/usernotifications/setting-up-a-remote-notification-server)

Google Calendar의 watch 알림은 **서버에 일정 변경을 알려주는 webhook**이며 휴대폰의 시작 알람이 아니다. 채널 만료 갱신 및 `syncToken` 무효화(410) 후 전체 재동기화도 별도로 검증한다. [Google watch](https://developers.google.com/workspace/calendar/api/guides/push), [Google 증분 동기화](https://developers.google.com/workspace/calendar/api/guides/sync)

## 격리 자동 테스트

Java 25와 Docker가 필요하다. 운영 DB·운영 기기로 테스트 알림을 보내지 않는다.

```sh
cd backend
./mvnw -B -Dtest='Notification*Test,RedTeamDataIntegrityTest' test
```

- `NotificationSchedulerTest`: 자정 경계, 최대 24시간 전, 지난주/날짜 없음/외부 일정 제외, 완료/취소, 변경 키, DST, 최신 제목, 큐 생성 후 삭제/변경/완료, 설정 변경, 만료/조기 claim/구버전 큐, 일일 알림 비활성화와 정상 전달 대조군.
- `NotificationRepositoryTest`: MySQL 실제 마이그레이션, 미래 시각 claim 금지/양성 대조군, 8개 동시 생성·8개 워커의 단일 claim, 키·UTC 시각 왕복, 신규 15분 기본값/기존 선택 유지, 일정 되돌리기에서 이미 전달된 알림 재발송 방지.
- `NotificationServiceTest`: 등록 기기 없음, 공급자 일시 오류 재시도, 만료 토큰 비활성화, 정상 공급자 성공 대조군.

## 베타 출시 수동 게이트 — 아직 기기 전달 증거 없음

다음 표는 실제 베타 계정/기기에서 수행 후 시각·OS·관측 결과를 남긴다. 자동 테스트 결과로 체크하지 않는다.

| 시나리오 | 통과 기준 | 상태 |
| --- | --- | --- |
| Google 연결/새로고침/해제 | 토큰 refresh 후 동기화, 수정/삭제 반영, 해제 후 재접근 차단 | 미검증 |
| Google watch 갱신/410 복구 | 채널 갱신, 누락 없이 전체 재동기화, 앱 소유 일정 보존 | 미검증 |
| 앱 일정 15분 전 | 실제 Android/iOS/Web 각각 알림 1회, 올바른 제목/화면 이동 | 미검증 |
| 자정/일정 수정/취소 | 변경 전 시각에 잘못된 알림 없음, 변경 후 시각은 1회 | 미검증 |
| 권한 거부·해제/로그아웃 | 원치 않는 알림 없음, 다른 계정으로 잘못 전달하지 않음 | 미검증 |
| 백그라운드·화면 꺼짐·오프라인 | 허용 상태에서 수신, TTL 만료 후 오래된 알림이 몰려오지 않음 | 미검증 |
| 워커 재시작/네이티브 재시도 | 동일 기기·동일 전달 키 중복 방어, 정상 다음 일정 수신 | 미검증 |

수동 게이트를 통과하기 전에는 랜딩/베타 안내에 “Android·iOS 알림 제공 완료”, “정확히 15분 전 수신 보장”이라고 쓰지 않는다.
