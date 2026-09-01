# Gates: Nowline full-stack MVP

OWNS: **

Scope: Deliver the responsive React/PWA/Capacitor planner, a Java 25 Spring API with PostgreSQL persistence, and a repeatable local Compose/Kubernetes runtime.

- [x] G1: Core product screens and state rules are covered by automated frontend tests
  CHECK: rtk npm run verify:unit
  EXPECT: frontend tests passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/jisubpark/develop/planner; path=bac1cdb55d49/23 entries; output=Duration  1.56s (transform 103ms, setup 103ms, import 194ms, tests 670ms, environment 489ms) | frontend tests passed

- [x] G2: The repository contains the required Today, Planner, Goals, Review, onboarding, responsive navigation, and local persistence structure
  CHECK: rtk npm run verify:structure
  EXPECT: frontend structure verification passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/jisubpark/develop/planner; path=bac1cdb55d49/23 entries; output=> node scripts/verify-structure.mjs | frontend structure verification passed

- [x] G3: A production PWA build completes and emits an application manifest plus service worker assets
  CHECK: rtk npm run verify:build
  EXPECT: frontend production build passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/jisubpark/develop/planner; path=bac1cdb55d49/23 entries; output=dist/workbox-9c191d2f.js | frontend production build passed

- [x] G4: Capacitor can synchronize the production web build into committed iOS and Android projects
  CHECK: rtk npm run verify:mobile
  EXPECT: mobile platform verification passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/jisubpark/develop/planner; path=bac1cdb55d49/23 entries; output=[info] Sync finished in 0.057s | mobile platform verification passed

- [x] G5: Desktop and mobile browser checks show the four primary flows without blocking layout defects or console errors
  EVIDENCE: In-app browser at 1280x720 and 390x844 rendered Today, Planner, Goals, Review, and onboarding; timer completion, time placement, and goal decision worked; console warning/error logs were empty; no page-level horizontal overflow; mobile primary targets measured 44-52px.

## Claude high-fidelity redesign

- [x] G6: Claude Design provides an explicit production UI source covering Today, Planner, Goals, Review, and mobile behavior, and its decisions are captured locally
  CHECK: rtk npm run verify:design-source
  EXPECT: Claude production design source verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/jisubpark/develop/planner; path=bac1cdb55d49/23 entries; output=> node scripts/verify-design-source.mjs | Claude production design source verified

- [x] G7: The implementation replaces the wireframe-level visual system with the captured Claude typography, color, spacing, surface, navigation, and component rules
  CHECK: rtk npm run verify:visual-system
  EXPECT: Claude visual system implementation verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/jisubpark/develop/planner; path=bac1cdb55d49/23 entries; output=> node scripts/verify-visual-system.mjs | Claude visual system implementation verified

- [x] G8: Existing timer, placement, goal-decision, review, PWA, and native synchronization behavior remains green after the redesign
  CHECK: rtk npm run verify:release
  EXPECT: redesigned frontend release verification passed
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/jisubpark/develop/planner; path=bac1cdb55d49/23 entries; output=mobile platform verification passed | redesigned frontend release verification passed

- [x] G9: Desktop and mobile browser comparison against the Claude Design source shows no material layout mismatch, blocking overflow, or console errors
  EVIDENCE: Claude source checked at its 1440x900 desktop and 390x844 mobile frames. Live implementation checked at 1440x900, 1024, 1023, 768, 767, and 391x844: page overflow=0 throughout; desktop Planner grid clientWidth=scrollWidth=1019px; mobile visible controls had no target below 44px; Today timer/finish sheet, Planner placement sheet, Goals decision, Review completion gate, and onboarding focus state rendered and operated; browser warning/error log=[] after all flows.

## Evidence-backed usability pass

- [x] G10: External usability criteria are translated into a product-specific audit without treating the intentionally absent backend as a frontend defect
  EVIDENCE: docs/USABILITY_REFERENCES.md separates WCAG 2.2 CSS-pixel criteria, Apple point guidance, Android dp guidance, Nielsen heuristics, and the internal 44 CSS px product bar. docs/USABILITY_AUDIT.md explicitly scopes all new behavior to localStorage demo state.

- [x] G11: Every P1 finding has a local frontend resolution or an explicit backend-stage boundary
  EVIDENCE: Local-save copy, reset confirmation, week navigation, task/plan editing, contextual carryover actions, overlap prevention, Review metric propagation, and next-week Top 3 handoff are implemented. Full history editing and multi-device persistence remain documented backend/history work.

- [x] G12: Automated usability contracts and local frontend flows pass
  CHECK: rtk npm run verify:usability
  EXPECT: frontend usability verification passed
  EVIDENCE: exit=0; Vitest 14/14 passed; active type=button controls, device-local save copy, reset confirmation, Planner/Goals/Review contracts, contrast token, scroll hints, and 44px style declarations passed; output=frontend usability verification passed.

- [x] G13: Desktop and mobile browser checks cover the revised end-to-end local flows
  EVIDENCE: At 1440x900 and 390x844, verified quick capture Enter, manual-time undo, exact carryover split/stop context, task creation, conflict rejection plus nonconflicting placement, week navigation, combined plan edit, metric validation and Goals propagation, Review-to-next-week handoff, onboarding conflict disablement, and reset cancellation. Five mobile screens had document overflow=0 and no visible enabled target below 44x44 CSS px. Browser warning/error count=0.

- [x] G14: The complete PWA and Capacitor release verification remains green after usability changes
  CHECK: rtk npm run verify:release
  EXPECT: redesigned frontend release verification passed
  EVIDENCE: exit=0; 14 tests passed; structure, design source, visual system, usability, TypeScript/Vite PWA build, Android sync, and iOS sync passed; output=redesigned frontend release verification passed.

- [x] G15: The synchronized Android project produces a debug APK
  EVIDENCE: JDK 21 with locally available Gradle 8.13 ran assembleDebug successfully; 93 tasks executed; output=BUILD SUCCESSFUL; artifact=android/app/build/outputs/apk/debug/app-debug.apk (4.1MB, ignored build output). The wrapper's first network download attempt was environment-blocked by Java certificate trust and was not bypassed insecurely.

## Java 25 backend and server synchronization

- [x] G16: The Java 25 Spring backend, normalized Flyway schema, API validation, health probes, metrics, and constrained database pool pass unit and PostgreSQL integration tests
  CHECK: rtk npm run verify:backend
  EXPECT: backend verification passed
  EVIDENCE: exit=0; Spring Boot 4.1.1 on Java 25.0.1; 7 unit tests and 5 Testcontainers PostgreSQL integration tests passed; PostgreSQL 17.9 migration, CORS preflights, readiness, Prometheus, and Hikari maximum 10 were exercised.

- [x] G17: Conditional writes, persistent idempotency, deletion/recreation revision monotonicity, overlap rejection, and cleanup are verified through the real HTTP and PostgreSQL path
  CHECK: rtk npm run verify:e2e
  EXPECT: backend end-to-end verification passed
  EVIDENCE: exit=0; create, replay, read, stale 412, update, idempotency-key 409, overlapping block 400, stale delete, delete, and final 404 passed. The verifier used and removed only a per-run named PostgreSQL volume.

- [x] G18: The frontend remains local-first while server hydration, acknowledged saves, offline retry, and explicit conflict preservation pass the complete PWA and native verification
  CHECK: rtk npm run verify:release
  EXPECT: redesigned frontend release verification passed
  EVIDENCE: exit=0; 2 test files and 26 tests passed; structure, design source, visual system, usability, TypeScript/Vite PWA build, Android sync, iOS sync, and restricted local-network configuration passed.

## Local Kubernetes scale-out

- [x] G19: The Kustomize package renders the required namespace, services, database, two-replica backend, frontend, HPA, PDB, probes, resource bounds, and spread constraints
  CHECK: rtk npm run verify:k8s
  EXPECT: validated 10 rendered Kubernetes objects
  EVIDENCE: exit=0; 10 objects passed semantic verification, including the bounded PostgreSQL init container and retained 5Gi PVC design.

- [x] G20: A real local cluster serves the frontend proxy and preserves optimistic concurrency across two independent backend Pods
  CHECK: rtk npm run verify:k8s:runtime
  EXPECT: local Kubernetes scale-out verification passed
  EVIDENCE: exit=0; two Ready backend Pods returned identical state; concurrent same-ETag writes sent to different Pods produced exactly one 200 and one 412; final revision agreed; HPA metrics were available. Final workload snapshot: all five Pods Ready with zero restarts, HPA 2 replicas at cpu 1%/70% and memory 43%/80%, PDB minAvailable 1, PVC Bound 5Gi.

- [x] G21: The production frontend, nginx proxy, Spring API, and PostgreSQL complete a browser save and reload flow through local Kubernetes
  EVIDENCE: In-app browser at http://127.0.0.1:4189/today displayed `서버에 저장됨`; adding `K8s 브라우저 저장 검증` produced a server acknowledgement, and a fresh navigation restored the task. This check first exposed a local dynamic-port CORS 403; origin patterns and integration coverage were corrected before the passing run.

## Release documentation and structural review

- [x] G22: Full-stack documentation, native local-network restrictions, and the final structural index match the implemented release
  CHECK: rtk npm run verify:full
  EXPECT: full stack verification passed
  EVIDENCE: exit=0; frontend release, backend verify, 10-object K8s structure, and isolated Compose HTTP E2E all passed. CodeGraph final index: 84 files, 904 nodes, 1,792 edges; WebConfiguration and the server-sync provider are indexed. README documents Compose, Kubernetes, mobile, API, security boundaries, and current limitations.

## Public production service

Scope: Replace the local-MVP trust boundaries with a deployable, multi-device, multi-plan service including production authentication, Google Calendar synchronization, user lifecycle controls, hardened Kubernetes operations, and release evidence.

- [x] G23: Every private API derives the tenant from a validated OIDC JWT and rejects missing, expired, wrong-issuer, wrong-audience, and cross-tenant access; the development user header no longer grants identity
  CHECK: rtk npm run verify:backend && rtk npm run verify:production:contracts
  EXPECT: backend verification passed; production implementation contracts verified
  EVIDENCE: PlannerApiIT 8/8 passed against PostgreSQL 17, including missing/expired/wrong issuer/wrong audience and tenant isolation; the production contract rejects any private `X-Nowline-User-Id` trust path.

- [x] G24: Web, PWA, iOS, and Android use Authorization Code with PKCE for sign-in, restore/refresh sessions safely, support logout, and return from platform deep links without storing refresh tokens in browser localStorage
  CHECK: rtk npm run verify:release && rtk npm run verify:production:contracts
  EXPECT: redesigned frontend release verification passed; production implementation contracts verified
  EVIDENCE: oidc-client-ts code flow, web session storage, native secure PKCE/state/nonce storage, custom-scheme callbacks, consent gate and logout are implemented; Capacitor sync passed and Android debug assembled. Full signed device evidence remains G43.

- [x] G25: A user can create, activate, close, archive, restore, and inspect multiple annual and quarterly plans while immutable audit events preserve material changes
  CHECK: rtk npm run verify:backend && rtk npm run verify:unit
  EXPECT: backend verification passed; frontend tests passed
  EVIDENCE: lifecycle, tenant isolation and audit HTTP integration scenarios passed; Plans UI covers creation, activation, close, archive, restore and empty-plan routing.

- [x] G26: A stale client receives a three-way comparison and can keep local, keep server, or selectively merge non-conflicting planner changes without losing either original snapshot
  CHECK: rtk npm run verify:unit && rtk npm run verify:e2e
  EXPECT: frontend tests passed; backend end-to-end verification passed
  EVIDENCE: 26 frontend tests cover server synchronization/conflict states and the conflict modal preserves base/local/server snapshots with local, server and field merge choices; HTTP ETag conflict behavior passed.

- [x] G27: Google Calendar connection uses least-privilege incremental consent, CSRF-safe OAuth state, offline access, encrypted refresh-token persistence, reconnect, revocation, and disconnect cleanup
  CHECK: rtk npm run verify:backend && rtk npm run verify:production:contracts
  EXPECT: backend verification passed; production implementation contracts verified
  EVIDENCE: implementation contracts verify least-privilege scopes, PKCE/state/offline access and AES-GCM storage; connection, revoke, reconnect and deletion paths compile and pass the Spring suite. Real Google approval/account evidence remains G42.

- [x] G28: Google Calendar performs durable bidirectional synchronization with pagination, sync-token persistence, 410 full-resync recovery, tombstones, time zones, recurrence-safe import, Nowline event identity, ETag conflict handling, retries, and quota backoff
  CHECK: rtk npm run verify:backend && rtk npm run verify:production:contracts
  EXPECT: backend verification passed; production implementation contracts verified
  EVIDENCE: GoogleCalendarSyncService tests 2/2 passed; production contracts cover pagination, sync token, 410 reset, tombstones, single-event recurrence handling and If-Match export.

- [x] G29: Calendar push channels are authenticated, renewable, deduplicated, and safe across multiple backend or worker replicas; missed or expired notifications converge through scheduled reconciliation
  CHECK: rtk npm run verify:backend && rtk npm run verify:k8s:runtime
  EXPECT: backend verification passed; local Kubernetes scale-out verification passed
  EVIDENCE: persistent watch/job queues use webhook channel/resource validation, unique deduplication, retry scheduling and DB claims safe across workers; two backend Pods passed the scale-out consistency check. Real Google webhook delivery remains G42.

- [x] G30: Users can configure in-app and device reminders with time-zone and quiet-hour handling, and delivery jobs are idempotent, retryable, observable, and safe across replicas
  CHECK: rtk npm run verify:release && rtk npm run verify:backend && rtk npm run verify:production:contracts
  EXPECT: frontend, backend and production contracts pass
  EVIDENCE: IANA time-zone preferences, encrypted subscriptions, idempotent delivery rows, retry/permanent failure handling, worker metrics and web/native adapters are implemented. Physical APNs/FCM delivery remains G43.

- [x] G31: Users can export their data, revoke integrations, and permanently delete their account in-app; retention, cascade deletion, privacy notice, terms, and support contact are documented and enforced
  CHECK: rtk npm run verify:backend && rtk npm run verify:production:contracts
  EXPECT: backend verification passed; production implementation contracts verified
  EVIDENCE: fresh-auth account deletion, export, preferences, policy-version consent and database cascade cleanup passed PlannerApiIT; scheduled operational-row retention and public legal routes are present.

- [x] G32: The public HTTP surface has exact-origin CORS, security headers, request-size and rate limits, secret redaction, encrypted integration credentials, safe error responses, dependency scanning, container scanning, SBOM generation, and no critical findings
  CHECK: rtk npm run verify:production
  EXPECT: production repository verification passed
  EVIDENCE: servlet security headers, bounded bodies, DB rate limiting, RFC problems, AES-GCM secrets, exact production origin contracts, CodeQL/Trivy/SBOM workflows and npm audit with 0 vulnerabilities passed repository verification.

- [x] G33: Production Kustomize resources use TLS ingress, external-secret contracts, default-deny NetworkPolicy, dedicated service accounts, restricted pods, disruption budgets, autoscaling, topology spread, migration jobs, and an external HA PostgreSQL contract
  CHECK: rtk npm run verify:k8s && rtk npm run verify:migration
  EXPECT: production Kubernetes manifest verification passed; production migration runner verification passed
  EVIDENCE: production manifests passed semantic verification; the one-shot container applied Flyway V1-V7 to PostgreSQL 17 and exited successfully in 2.89s.

- [x] G34: Backup, point-in-time recovery, migration rollback, key rotation, incident response, and disaster recovery runbooks have executable local drills and measured RPO/RTO evidence
  CHECK: rtk npm run verify:recovery
  EXPECT: production recovery drill passed
  EVIDENCE: PostgreSQL 17 custom-format backup/restore preserved the seeded fingerprint with 0 rows lost; measured local backup 0.08s and restore 0.19s. Managed-provider PITR proof remains G41.

- [x] G35: Structured logs, trace correlation, RED metrics, business sync metrics, dashboards, SLOs, and actionable alerts cover API, database, calendar, notification, and worker failure paths without recording sensitive tokens or planner content
  CHECK: rtk npm run verify:k8s && rtk npm run verify:production:contracts
  EXPECT: monitoring manifests and implementation contracts pass
  EVIDENCE: OTel trace/log correlation, request/DB/integration/notification/retention metrics, ServiceMonitor and PrometheusRule SLO alerts are present and exclude token/planner bodies. Real alert-channel delivery remains G41.

- [x] G36: CI/CD independently verifies frontend, backend, database migrations, API compatibility, images, Kubernetes policy, security scans, and end-to-end flows before producing immutable versioned release artifacts with rollback instructions
  CHECK: rtk npm run verify:production:contracts
  EXPECT: production implementation contracts verified
  EVIDENCE: CI, CodeQL, mobile release and container release workflows parsed successfully; release builds both images with provenance/SBOM, scans, signs, migrates, pins digests and verifies rollout.

- [x] G37: iOS and Android production projects use secure deep links, HTTPS-only networking, protected token storage, notification capabilities, environment-specific configuration, release build checks, account deletion, and store-submission checklists
  CHECK: rtk npm run verify:mobile && rtk npm run verify:production:contracts
  EXPECT: mobile platform verification passed; production implementation contracts verified
  EVIDENCE: production Android cleartext is denied with debug-only local exceptions, iOS ATS is scoped, secure OIDC state/deep links/push/privacy manifests are committed, Capacitor sync passed, and Android assembleDebug completed 215 tasks. Signed device/store proof remains G43.

- [x] G38: Authenticated browser and API end-to-end tests cover onboarding, plan history, offline editing, conflict merge, calendar connect/sync/disconnect, reminders, export, and account deletion on desktop and mobile viewports
  CHECK: rtk npm run verify:production:e2e
  EXPECT: production authenticated browser end-to-end verification passed
  EVIDENCE: exit=0; isolated PostgreSQL/backend/frontend/fake Google runtime completed policy consent, onboarding, offline quick capture, three-way conflict comparison and merge, plan creation and audit, Google connect/calendar/sync/disconnect/revoke, reminder preferences, export, fresh-auth account deletion and logout in branded Chrome; 390x844 mobile Today/Plans/Settings had no horizontal overflow and effective primary controls were at least 44px.

- [x] G39: Load, soak, failover, multi-replica concurrency, calendar quota, retry-storm, and database-pool tests meet documented capacity and recovery thresholds without lost or cross-tenant data
  CHECK: rtk npm run verify:production:reliability
  EXPECT: production reliability verification passed
  EVIDENCE: exit=0; two Java 25 backend instances shared PostgreSQL 17; cross-tenant read returned 404; same-ETag writes produced 1 success and 19 rejections; 400 requests at concurrency 32 had 0 failures and p95 134.0ms; 30-second soak completed 298 requests with 0 failures and p95 31.9ms; Hikari maximum was 8 per instance with 0 pending; after stopping backend A, 100/100 reads passed on B; 50 concurrent calendar sync requests deduplicated to 1 active job and one simulated 429 succeeded on attempt 2 with provider concurrency 1.

- [x] G40: The README and operator/developer runbooks describe local development, identity-provider setup, Google verification, production deployment, monitoring, backup restore, incident handling, privacy operations, mobile release, and every required external credential
  CHECK: rtk npm run verify:production:contracts
  EXPECT: production implementation contracts verified
  EVIDENCE: README, Production setup, Operations runbook, Mobile release and UX audit are linked and checked as release contracts; external ownership gates remain explicitly listed below.

- [ ] G41: A real public staging environment with a user-owned domain and trusted TLS passes smoke, security-header, multi-replica, rollback, backup-restore, and alert-delivery checks
  EVIDENCE: pending; requires the target cloud, domain/DNS control, and production secret manager

- [ ] G42: A real Google Cloud OAuth app that completed the required consent-screen/testing or verification process passes connect, offline refresh, import, export, webhook, revoke, and reconnect checks with a real Google account
  EVIDENCE: pending; requires Google Cloud project ownership, OAuth client credentials, verified redirect domain, and a test account

- [ ] G43: Signed iOS and Android release candidates pass physical-device, push-notification, deep-link, account-deletion, privacy-disclosure, and store preflight checks
  EVIDENCE: pending; requires Apple Developer and Google Play accounts, signing identities, bundle/application IDs, and physical devices
