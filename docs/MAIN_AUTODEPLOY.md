# main → Mac mini 자동 배포

`git push origin main` 한 번으로 `.github/workflows/ci.yml`의 테스트부터 실제 이미지 교체·검증까지 실행합니다. `codex/**`와 PR은 테스트만 실행합니다. Actions의 `publish-mac-mini`, `deploy-mac-mini`까지 성공한 실행이 배포 완료입니다.

## 동작 순서

1. GitHub hosted runner에서 프론트, Java 25 백엔드, Kustomize, API/production E2E를 검증합니다.
2. ARM64 runner에서 공개 OIDC 설정으로 웹을 빌드하고 frontend/backend/Keycloak 이미지를 GHCR에 게시합니다. 이미지 태그와 OCI revision label은 모두 `sha-<전체 Git SHA>`에 대응합니다.
3. `goalstotoday-mac-mini` 실행기가 게시 단계가 반환한 **digest**로 이미지를 내려받습니다. 임시 `GITHUB_TOKEN`은 임시 Docker 설정에서만 사용합니다.
4. Docker 이미지의 OS·ARM64·revision label을 검사하고 kind의 모든 기존 노드에 import합니다. import한 manifest의 config digest도 원본 Docker 이미지 ID와 비교합니다.
5. `nowline`과 `keycloak` MySQL 데이터를 함께 dump/gzip하고 SHA-256을 기록합니다. 현재 `main`과 배포 SHA가 다르면 교체 전에 중단합니다.
6. 기존 배포의 환경변수·Secret 참조·복제본 수를 유지하면서 backend/frontend/Keycloak 이미지를 커밋 태그로 교체합니다. MySQL/PVC/Tunnel은 재생성하지 않습니다.
7. 세 Deployment의 모든 Ready Pod, 실행 중 imageID, `https://goalstotoday.com/version.json`, health, OIDC issuer, 미인증 API 401을 검사합니다. 서비스가 검증된 뒤 서버 checkout도 해당 `main` 커밋으로 fast-forward합니다.

배포 중 실패하면 변경한 Deployment의 이전 Pod 템플릿을 복원하고 rollout 결과를 기록합니다. 자동 rollback은 DB schema를 역마이그레이션하지 않습니다. 새 Flyway 변경은 이전 앱과 호환되도록 작성하고, 호환되지 않는 변경의 복원에는 아래 백업을 사용합니다.

## 실제 운영 경로

| 항목 | 값 |
|---|---|
| SSH | `ssh mac-mini` |
| 서버 checkout | `/Users/jieseobpark/develop/planner` (`main`) |
| Kubernetes | `kind-nowline-local`, namespace `nowline-local` |
| Docker | Colima, Linux ARM64 |
| 실행기 | `~/.local/share/goalstotoday-runner` |
| 실행기 로그 | `~/.local/state/goalstotoday-runner/runner.log` |
| 최종 배포 증거 | `~/.local/state/goalstotoday-deploy/release.json` |
| 이전 배포 증거 | `~/.local/state/goalstotoday-deploy/previous-release.json` |
| rollout 전 템플릿/DB 백업 | 같은 디렉터리의 `before-<sha>.json`, `mysql-<sha>-<timestamp>.sql.gz` |

운영 비밀 값과 DB 백업은 Git에 넣지 않습니다. 백업은 자동 삭제하지 않으므로 용량·보관 기간과 별도 저장소 복제는 운영자가 관리합니다.

## 실행기 설치와 재부팅 복구

Mac mini의 배포 실행기는 GitHub에 outbound 연결하므로 SSH·Kubernetes API를 외부에 추가 노출하지 않습니다. GitHub `mac-mini-production` environment는 `main`만 허용합니다. 호스트에 설치한 job-start guard는 `jieseob1/planner`, `CI`, `main`, `deploy-mac-mini`, `push/workflow_dispatch`를 검사합니다. 외부 기여자의 PR workflow는 매번 승인을 받도록 설정합니다. 실행기 권한이 있는 호스트이므로 승인 전 workflow 변경을 반드시 검토합니다.

설치기는 현재 사용자 crontab의 다른 항목을 보존하고 별도 `GOALS_TO_TODAY_RUNNER` 구간에 `@reboot`와 1분 watchdog을 추가합니다. 기존 Tunnel/Colima supervisor와 별도로 작동하며 GUI 로그인에 의존하지 않습니다. 공식 [`runsvc.sh` 서비스 진입점](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/configure-the-application)을 사용합니다.

최초 설치: 설치기와 `mac-mini-runner-guard.sh`, `mac-mini-runner-supervisor.mjs`를 서버의 같은 디렉터리에 둔 뒤, 관리자 컴퓨터에서 등록 토큰을 표준입력으로 전달합니다. 토큰 출력이나 파일 저장은 하지 않습니다.

```bash
gh api --method POST repos/jieseob1/planner/actions/runners/registration-token --jq .token \
  | ssh mac-mini 'bash /Users/jieseobpark/develop/planner/scripts/install-mac-mini-deploy-runner.sh'
```

## 확인·재배포·복구

```bash
# 관리자 컴퓨터: 최신 main checkout에서 실행
npm run verify:goalstotoday:deployment
npm run verify:goalstotoday:public
gh run list --workflow ci.yml --branch main

# 최신 main을 같은 경로로 재검증·재배포
gh workflow run ci.yml --ref main

# 서버에서 현재 실제 Pod 이미지 ID와 공개 버전 검증
ssh mac-mini 'export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin; node /Users/jieseobpark/develop/planner/scripts/deploy-mac-mini.mjs --verify'
```

실행기가 offline이면 GitHub runner 상태와 `runner.log`, `supervisor.log`, crontab을 확인합니다. 강제 종료로 `goalstotoday-deploy/deploy.lock`이 남았다면 기록된 PID의 배포 프로세스가 끝났는지 확인하고, 실제 Deployment/공개 버전을 조사한 후 lock을 제거하고 CI를 재실행합니다. 진행 중 배포는 취소하지 않는 것이 원칙입니다.

Mac mini의 재부팅 자체는 이 변경의 검증 과정에서 수행하지 않습니다. watchdog 등록과 실행기 online 상태를 확인합니다. 기존 `scripts/k8s-local.sh up`은 개발용 고정 태그로 다시 빌드하므로 공개 서버의 정규 업데이트에는 위 CI를 사용합니다.

기존 `release.yml`은 태그 기반 일반 production overlay 배포용으로 남아 있으며 Mac mini의 정규 배포 경로는 `ci.yml`입니다. 실제 Google OAuth 승인·유료 결제·스토어 서명 등 외부 공급자 설정은 별도 작업입니다.
