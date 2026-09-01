# Gates: Nowline full-stack MVP

OWNS: **

Scope: Deliver the responsive React/PWA/Capacitor planner, a Java 25 Spring API with MySQL 8.4 persistence, and a repeatable local Compose/Kubernetes runtime.

- [x] G1: Core product screens and state rules are covered by automated frontend tests
  CHECK: rtk npm run verify:unit
  EXPECT: frontend tests passed
  EVIDENCE: exit=0; 4 test files and 29 tests passed, including error-alert focus and modal trigger-focus restoration regressions; output=frontend tests passed

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

- [x] G10: External usability criteria are translated into a product-specific audit, and the historical local-only findings are separated from the current production-connected verdict
  EVIDENCE: docs/USABILITY_REFERENCES.md separates WCAG 2.2 CSS-pixel criteria, Apple point guidance, Android dp guidance, Nielsen heuristics, and the internal 44 CSS px product bar. docs/USABILITY_AUDIT.md labels the 2026-08-31 localStorage findings as history and points current readers to the production UX audit and feature matrix.

- [x] G11: Every historical P1 finding has a production implementation or an explicit external-validation boundary
  EVIDENCE: Server-acknowledged save copy, conditional server reset, week navigation, task/plan editing, contextual carryover actions, overlap prevention, Review metric propagation, next-week Top 3 handoff, multi-plan history and multi-device ETag synchronization are implemented. Physical-device assistive technology and provider credentials remain external gates G41-G43.

- [x] G12: Automated usability contracts and local frontend flows pass
  CHECK: rtk npm run verify:usability
  EXPECT: frontend usability verification passed
  EVIDENCE: exit=0; 4 Vitest files and 29 tests passed; active controls, server save/reset behavior, Planner/Goals/Review contracts, alert focus, modal focus restoration, contrast token, scroll hints, offline retry, conflict preservation and 44px style declarations passed; output=frontend usability verification passed.

- [x] G13: Desktop and mobile browser checks cover the revised end-to-end local flows
  EVIDENCE: Current production E2E at 1440x900 and 390x844 verified policy consent, onboarding, keyboard-operated Today/Planner/Goals/Review, offline retry, conflict merge, plan lifecycle, Google test-provider flow, preferences, export and deletion. Six responsive routes had document overflow=0, effective primary controls were at least 44px, 720x450 new-plan/delete modals fit and restored focus, light-only/reduced-motion preferences held, and captured browser console errors were 0.

- [x] G14: The complete PWA and Capacitor release verification remains green after usability changes
  CHECK: rtk npm run verify:release
  EXPECT: redesigned frontend release verification passed
  EVIDENCE: exit=0; 29 tests passed; structure, design source, visual system, usability, TypeScript/Vite PWA build, Android sync, and iOS sync passed; output=redesigned frontend release verification passed.

- [x] G15: The synchronized Android project produces a debug APK
  EVIDENCE: JDK 21 with the locally cached Gradle 8.13 distribution ran assembleDebug successfully at final audit; 215 actionable tasks (27 executed, 188 up-to-date); output=BUILD SUCCESSFUL; artifact=android/app/build/outputs/apk/debug/app-debug.apk (8.1MB, ignored build output). The wrapper download was blocked by local Java certificate trust, so the verified cached distribution was used without weakening TLS.

## Java 25 backend and server synchronization

- [x] G16: The Java 25 Spring backend, normalized Flyway schema, API validation, health probes, metrics, and constrained database pool pass unit and MySQL integration tests
  CHECK: rtk npm run verify:backend
  EXPECT: backend verification passed
  EVIDENCE: exit=0; Spring Boot 4.1.1 on Java 25.0.1; Testcontainers MySQL 8.4.10 applied Flyway V1-V8 and exercised entitlement provisioning, CORS preflights, readiness, Prometheus, Hikari maximum 10, single job claim across 24 virtual threads, and bounded transient-lock retry.

- [x] G17: Conditional writes, persistent idempotency, deletion/recreation revision monotonicity, overlap rejection, and cleanup are verified through the real HTTP and MySQL path
  CHECK: rtk npm run verify:e2e
  EXPECT: backend end-to-end verification passed
  EVIDENCE: exit=0; create, replay, read, stale 412, update, idempotency-key 409, overlapping block 400, stale delete, delete, and final 404 passed. The verifier used and removed only a per-run named MySQL volume.

- [x] G18: The frontend remains local-first while server hydration, acknowledged saves, offline retry, and explicit conflict preservation pass the complete PWA and native verification
  CHECK: rtk npm run verify:release
  EXPECT: redesigned frontend release verification passed
  EVIDENCE: exit=0; 4 test files and 29 tests passed; structure, design source, visual system, usability, TypeScript/Vite PWA build, Android sync, iOS sync, and restricted local-network configuration passed.

## Local Kubernetes scale-out

- [x] G19: The Kustomize package renders the required namespace, services, database, two-replica backend, frontend, HPA, PDB, probes, resource bounds, and spread constraints
  CHECK: rtk npm run verify:k8s
  EXPECT: validated 13 rendered Kubernetes objects
  EVIDENCE: exit=0; 13 objects passed semantic verification, including the bounded MySQL init container, retained 5Gi PVC, Keycloak service/deployment, and runtime-only Secret boundary.

- [x] G20: A real local cluster serves the frontend proxy and preserves optimistic concurrency across two independent backend Pods
  CHECK: rtk npm run verify:k8s:runtime
  EXPECT: local Kubernetes scale-out verification passed
  EVIDENCE: exit=0; an isolated short-lived user was created and automatically removed; two Ready backend Pods returned identical MySQL state; concurrent same-ETag writes sent to different Pods produced exactly one 200 and one 412; final revision agreed; HPA metrics were available. Final workload snapshot: all five Pods Ready with zero restarts, HPA 2 replicas at cpu 11%/70% and memory 57%/80%, PDB minAvailable 1, both the active MySQL PVC and retained PostgreSQL recovery PVC Bound at 5Gi.

- [x] G21: The production frontend, nginx proxy, Spring API, and MySQL complete a browser save and reload flow through local Kubernetes
  EVIDENCE: In-app browser at http://127.0.0.1:4189/today displayed `서버에 저장됨`; adding `K8s 브라우저 저장 검증` produced a server acknowledgement, and a fresh navigation restored the task. This check first exposed a local dynamic-port CORS 403; origin patterns and integration coverage were corrected before the passing run.

## Release documentation and structural review

- [x] G22: Full-stack documentation, native local-network restrictions, and the final structural index match the implemented release
  CHECK: rtk npm run verify:full
  EXPECT: full stack verification passed
  EVIDENCE: exit=0; frontend release, backend verify, Kubernetes structure, and isolated Compose HTTP E2E all passed. CodeGraph final index: 165 files, 2,433 nodes, 5,239 edges; MySQL repositories, DatabaseWriteExecutor, WebConfiguration, and the server-sync provider are indexed. README documents Compose, Kubernetes, mobile, API, security boundaries, and current limitations.

## Public production service

Scope: Replace the local-MVP trust boundaries with a deployable, multi-device, multi-plan service including production authentication, Google Calendar synchronization, user lifecycle controls, hardened Kubernetes operations, and release evidence.

- [x] G23: Every private API derives the tenant from a validated OIDC JWT and rejects missing, expired, wrong-issuer, wrong-audience, and cross-tenant access; the development user header no longer grants identity
  CHECK: rtk npm run verify:backend && rtk npm run verify:production:contracts
  EXPECT: backend verification passed; production implementation contracts verified
  EVIDENCE: PlannerApiIT passed against MySQL 8.4, including missing/expired/wrong issuer/wrong audience, tenant isolation, MySQL job claiming, and deadlock retry; the production contract rejects any private `X-Nowline-User-Id` trust path.

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
  EVIDENCE: 29 frontend tests cover server synchronization/conflict states and the conflict modal preserves base/local/server snapshots with local, server and field merge choices; HTTP ETag conflict behavior passed.

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

- [x] G33: Production Kustomize resources use TLS ingress, external-secret contracts, default-deny NetworkPolicy, dedicated service accounts, restricted pods, disruption budgets, autoscaling, topology spread, migration jobs, and an external HA MySQL contract
  CHECK: rtk npm run verify:k8s && rtk npm run verify:migration
  EXPECT: production Kubernetes manifest verification passed; production migration runner verification passed
  EVIDENCE: production manifests passed semantic verification; the one-shot container applied Flyway V1-V8 to MySQL 8.4 in 5.37s, restarted in 5.51s, and retained all eight checksums without a failed migration.

- [x] G34: Backup, point-in-time recovery, migration rollback, key rotation, incident response, and disaster recovery runbooks have executable local drills and measured RPO/RTO evidence
  CHECK: rtk npm run verify:recovery
  EXPECT: production recovery drill passed
  EVIDENCE: MySQL 8.4 single-transaction backup/restore preserved the seeded fingerprint with 0 rows lost; measured local backup 0.15s and restore 0.41s. Managed-provider PITR proof remains G41.

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
  EVIDENCE: exit=0; isolated MySQL/backend/frontend/fake Google runtime completed policy consent, keyboard-operated Today/Planner/Goals/Review, offline quick capture, three-way conflict comparison and merge, plan creation and audit, Google connect/calendar/sync/disconnect/revoke, reminder preferences, export, fresh-auth account deletion and logout in branded Chrome. Every planner mutation waited for an actual successful PUT. 390x844 mobile screens had no horizontal overflow and effective primary controls were at least 44px; 720x450 core modals, focus restoration, light-only dark-OS behavior and reduced motion passed.

- [x] G39: Load, soak, failover, multi-replica concurrency, calendar quota, retry-storm, and database-pool tests meet documented capacity and recovery thresholds without lost or cross-tenant data
  CHECK: rtk npm run verify:production:reliability
  EXPECT: production reliability verification passed
  EVIDENCE: exit=0 against MySQL 8.4.10 and two Java 25 backend instances; 400 requests at concurrency 32 completed in 3110.9ms with p95 633.9ms and 0 failures; the 30-second soak completed 299 requests at p95 37.1ms with 0 failures; concurrent writes produced 1 success and 19 precondition rejections; 100/100 failover reads succeeded; each pool stayed at maximum 8; 50 Calendar sync requests deduplicated to 1 active job and recovered from one Google 429 on the second attempt with provider concurrency 1.

- [x] G40: The README and operator/developer runbooks describe local development, identity-provider setup, Google verification, production deployment, monitoring, backup restore, incident handling, privacy operations, mobile release, and every required external credential
  CHECK: rtk npm run verify:production:contracts
  EXPECT: production implementation contracts verified
  EVIDENCE: README, Production setup, Operations runbook, Mobile release and UX audit are linked and checked as release contracts; external ownership gates remain explicitly listed below.

- [x] G44: PostgreSQL runtime dependencies are removed, existing local data is preserved and converted into a fresh MySQL 8.4 volume, and migration/recovery/concurrency safeguards are executable
  CHECK: rtk npm run verify:mysql-contract && rtk npm run verify:migration && rtk npm run verify:recovery && rtk npm run verify:e2e && rtk npm run verify:backend
  EXPECT: migration restart checksums stable; recovery fingerprint equal; HTTP and MySQL integration tests pass
  EVIDENCE: the automated MySQL contract scanned 111 runtime/test files and 7 current docs for PostgreSQL packages, ports, tools and dialect while asserting MySQL driver, UTC, utf8mb4, InnoDB, locks, retries, backup and test-runner contracts. Neither retained PostgreSQL volume was deleted. Compose: custom-format dump SHA-256 `e6f3b9f999f91553816833c1ce745bef8f80e46c2018f2efaea838da29332939`; the importer moved 1 user, 1 active plan, 6 tasks, 4 outcomes, 4 time blocks and related rows into `nowline-mysql-data`; every table count and planner fingerprint matched, evidence SHA-256 `f9adc24d172f36488cbaa9cdee4113b013d6461a3f9364638c012b3130b1f3c9`; the migrated API returned revision 1 with all 6 tasks. Kubernetes: custom-format dump SHA-256 `187db77481335fcc75b7996c8463952d8ab229ebf7f8ea8589f902e3d235ab34`; the importer moved 6 users, 2 plans, 1 active aggregate, 7 tasks, 4 outcomes, 4 time blocks and related rows; every table count and planner fingerprint matched, evidence SHA-256 `457b87104f1bfbcd8d47f307df9b8f18fca6336f8bcf84645c15ad9aa3976245`. The old PostgreSQL workload was removed only after verification; its 5Gi PVC and both dump files remain available for recovery.

- [ ] G41: A real public staging environment with a user-owned domain and trusted TLS passes smoke, security-header, multi-replica, rollback, backup-restore, and alert-delivery checks
  EVIDENCE: pending; requires the target cloud, domain/DNS control, and production secret manager

- [ ] G42: A real Google Cloud OAuth app that completed the required consent-screen/testing or verification process passes connect, offline refresh, import, export, webhook, revoke, and reconnect checks with a real Google account
  EVIDENCE: pending; requires Google Cloud project ownership, OAuth client credentials, verified redirect domain, and a test account

- [ ] G43: Signed iOS and Android release candidates pass physical-device, push-notification, deep-link, account-deletion, privacy-disclosure, and store preflight checks
  EVIDENCE: pending; requires Apple Developer and Google Play accounts, signing identities, bundle/application IDs, and physical devices. Unsigned iOS simulator build was also attempted locally but the selected developer directory contains Command Line Tools rather than full Xcode; Capacitor sync and the macOS release workflow contract remain verified.

## Local multi-user public beta

- [x] G45: The local beta stack uses self-hosted OIDC registration and per-user JWTs, and the development token endpoint is absent
  CHECK: rtk node scripts/verify-local-beta-contracts.mjs
  EXPECT: local beta contracts verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/jisubpark/develop/planner; path=f5d0056e435b/23 entries; output=local beta contracts verified

- [x] G46: The frontend, Spring API, MySQL schema, self-hosted identity configuration, and beta entitlement API pass their automated suites
  CHECK: rtk npm run verify:beta
  EXPECT: local beta implementation verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/jisubpark/develop/planner; path=f5d0056e435b/23 entries; output=WARNING: If a serviceability tool is not in use, please run with -Djdk.instrument.traceUsage for more information | WARNING: Dynamic loading of agents will be disallowed by default in a future release

- [x] G47: Two independently registered local-beta users can sign in through OIDC, accept policy, store isolated planner data, log out, and sign back in without data loss
  CHECK: rtk npm run verify:beta:runtime
  EXPECT: local beta multi-user runtime verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/jisubpark/develop/planner; path=f5d0056e435b/23 entries; output=Container nowline-beta-keycloak-1 Healthy | Container nowline-beta-frontend-1 Healthy

- [x] G48: The local MySQL database can be backed up without stopping the service and the backup command supports optional S3 Glacier-class archival
  CHECK: rtk npm run verify:beta:backup
  EXPECT: local beta backup verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/jisubpark/develop/planner; path=f5d0056e435b/23 entries; output=verified backup nowline-20260901T045150Z.sql.gz (12618 bytes) | local beta backup verified

- [x] G49: The local Kubernetes overlay includes MySQL-backed Keycloak, internal JWK discovery, two backend replicas, and no development JWT secret
  CHECK: rtk npm run verify:k8s
  EXPECT: local Kubernetes configuration verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/jisubpark/develop/planner; path=f5d0056e435b/23 entries; output=local Kubernetes configuration verified | production Kubernetes manifest verification passed

- [x] G50: The local Kubernetes server is running the multi-user beta build and passes OIDC discovery, health, login, tenant-isolation, and persistence smoke checks
  CHECK: rtk npm run verify:beta:k8s:runtime
  EXPECT: local Kubernetes beta runtime verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/jisubpark/develop/planner; path=f5d0056e435b/23 entries; output=local beta multi-user runtime verified | local Kubernetes beta runtime verified

## Public landing page

- [x] G51: The public landing route presents Nowline's plan-to-action value, implemented features, honest coming-soon states, beta terms, and working conversion links on desktop and mobile
  CHECK: rtk npm run verify:landing
  EXPECT: landing page verification passed
  EVIDENCE: exit=0; Vitest 2/2 landing component tests passed and the static route/content/responsive contract printed `landing page verification passed`

- [x] G52: The landing-page change preserves the authenticated planner, production build, accessibility contracts, mobile layout, and release verification
  CHECK: rtk npm run verify:release
  EXPECT: release verification passed
  EVIDENCE: exit=0; 31/31 frontend tests passed; production build, design source, visual system, usability, PWA, Android and iOS Capacitor sync checks passed; output=`redesigned frontend release verification passed`

- [x] G53: The rendered landing page matches the supplied Claude Design source at equivalent desktop and mobile viewports with no actionable P0, P1, or P2 design-QA findings
  EVIDENCE: `design-qa.md` result=`passed`; 1440x1000 and 390x844 side-by-side inputs recorded; desktop navigation and `/today` CTA worked; mobile document width was 390/390px, primary controls were 48px, comparison table scrolled internally at 780/370px, and browser warnings/errors were empty

## Goals to Today public-domain release

Scope: Rebrand the public beta as Goals to Today, publish it through the user-owned `goalstotoday.com` Cloudflare zone without disrupting existing tunnel routes, and prove the HTTPS, identity, API, deployment, and repository state end to end.

- [ ] G54: User-facing product metadata, landing content, authentication copy, native app labels, deployment configuration, and operator documentation consistently use Goals to Today and the canonical `https://goalstotoday.com` origin
  CHECK: rtk npm run verify:goalstotoday:contracts
  EXPECT: Goals to Today domain and brand contracts verified
  EVIDENCE: pending

- [ ] G55: The rebranded frontend, Java 25 backend, PWA, native synchronization, local-beta contracts, and Kubernetes manifests pass the repository release checks
  CHECK: rtk npm run verify:goalstotoday:release
  EXPECT: Goals to Today repository release verification passed
  EVIDENCE: pending

- [ ] G56: The Mac mini Kubernetes deployment runs the pushed Goals to Today revision and passes OIDC discovery, health, authenticated tenant isolation, persistence, and restart-safe runtime checks
  CHECK: rtk npm run verify:beta:k8s:runtime
  EXPECT: local Kubernetes beta runtime verified
  EVIDENCE: pending

- [ ] G57: The public apex and www hostnames resolve through Cloudflare with trusted HTTPS, security headers, canonical routing, landing content, OIDC discovery, and API readiness while the existing SSH route remains usable
  CHECK: rtk npm run verify:goalstotoday:public
  EXPECT: Goals to Today public HTTPS, OIDC, SSH, desktop, and mobile verification passed
  EVIDENCE: pending

- [ ] G58: Desktop and mobile browser QA completes landing-to-sign-in navigation, registration, authenticated planner load, save/reload, logout, and responsive/console checks through `https://goalstotoday.com`
  EVIDENCE: pending

- [ ] G59: Local, origin, and Mac mini checkouts identify the same pushed release commit with no task-owned uncommitted changes
  CHECK: rtk npm run verify:goalstotoday:deployment
  EXPECT: Goals to Today deployment revision verified
  EVIDENCE: pending
