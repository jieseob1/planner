# Nowline 신뢰성 기준

## 목적과 범위

`npm run verify:production:reliability`는 공개 배포 전에 저장소에서 반복 가능한 최소 신뢰성 게이트다. Java 25 backend 두 인스턴스와 PostgreSQL 17, 가짜 Google Calendar 공급자를 격리된 Docker network에 올려 tenant 격리, 동시성, 부하, 제한된 soak, 장애 전환, 외부 API quota 재시도를 확인한다.

이 검증은 실제 cloud 장기 부하 시험이나 운영 SLA 증거를 대신하지 않는다. 실제 domain/TLS, 관리형 DB의 PITR, alert 전달과 장시간 soak은 G41에서 별도로 확인해야 한다.

## 자동 판정 기준

| 영역 | 기준 |
| --- | --- |
| tenant 격리 | 다른 사용자의 planner 조회는 404 |
| 다중 인스턴스 | A에서 쓴 데이터를 B에서 즉시 조회 가능 |
| 낙관적 동시성 | 같은 ETag를 사용한 20건 중 정확히 1건 성공, 19건은 412 |
| 순간 부하 | 400 GET, concurrency 32, 오류 0건, p95 1,500ms 이하 |
| 제한된 soak | 30초 동안 약 10 req/s, 오류 0건, p95 1,500ms 이하 |
| DB pool | 인스턴스별 최대 8, active가 maximum 이하, 대기 0 |
| 장애 전환 | backend A 중단 뒤 B에서 100회 조회 모두 성공 |
| calendar retry storm | 동시 sync 50건이 활성 job 1건으로 합쳐짐 |
| quota recovery | Google 429 1회 뒤 정확히 2번째 시도에서 성공 |
| 공급자 동시성 | Google 요청 최대 동시성 4 이하 |

soak 시간은 `NOWLINE_RELIABILITY_SOAK_SECONDS`로 늘릴 수 있으며 최소값은 5초다. 운영 후보에서는 CI 기본 30초 외에 staging에서 더 긴 구간을 별도로 실행한다.

## 최근 로컬 측정

측정일: 2026-09-01. 환경: macOS Docker runtime, PostgreSQL 17.6, Java 25 backend 2개. 아래 값은 마지막 통과 실행 후 갱신한다.

- 순간 부하: 400건 / concurrency 32 / 총 900.6ms / p95 134.0ms / 오류 0건
- 제한된 soak: 30초 / 298건 / p95 31.9ms / 오류 0건
- 동시 수정: 1 성공 / 19 precondition rejection
- 장애 전환: 100 / 100 성공
- DB pool: 인스턴스별 최대 8, 대기 0
- Calendar: 동시 요청 50건 → 활성 job 1건, 429 1회 → 2번째 시도 성공, 공급자 최대 동시 요청 1건

## 실행

```bash
npm run verify:production:reliability
```

검증기는 성공·실패와 관계없이 자신이 만든 컨테이너, network, backend image를 정리한다. 실패하면 판정 메시지와 각 backend의 마지막 로그를 출력한다.
