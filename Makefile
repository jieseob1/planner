COMPOSE_PROJECT ?= nowline-local
NOWLINE_FRONTEND_PORT ?= 8088
NOWLINE_BACKEND_PORT ?= 8080

export NOWLINE_FRONTEND_PORT
export NOWLINE_BACKEND_PORT

COMPOSE = docker compose --project-name $(COMPOSE_PROJECT) --file compose.yaml

.PHONY: help frontend-dist backend-jar compose-config compose-build compose-up compose-verify compose-logs compose-down k8s-render k8s-build k8s-up k8s-verify k8s-down

help:
	@printf '%s\n' \
	  'compose-config  Validate the resolved Compose model' \
	  'compose-build   Build frontend and backend images' \
	  'compose-up      Build and start frontend, backend, and MySQL' \
	  'compose-verify  Check frontend and backend HTTP health' \
	  'compose-logs    Follow logs for the three named services' \
	  'compose-down    Stop the stack and retain the MySQL volume' \
	  'k8s-render      Render and structurally verify the local overlay' \
	  'k8s-build       Build images and load them when the context is kind' \
	  'k8s-up          Apply the local overlay and wait for rollouts' \
	  'k8s-verify      Verify rollouts and HTTP health through port-forward' \
	  'k8s-down        Remove named workloads while retaining namespace/PVC'

compose-config:
	$(COMPOSE) config

frontend-dist:
	VITE_API_BASE_URL= npm run build

backend-jar:
	./backend/mvnw --quiet --file backend/pom.xml package -DskipTests

compose-build: compose-config frontend-dist backend-jar
	$(COMPOSE) build

compose-up: frontend-dist backend-jar
	$(COMPOSE) up --detach --build --wait --wait-timeout 180

compose-verify:
	curl --fail --silent --show-error --max-time 5 http://127.0.0.1:$(NOWLINE_FRONTEND_PORT)/healthz
	curl --fail --silent --show-error --max-time 5 http://127.0.0.1:$(NOWLINE_BACKEND_PORT)/actuator/health/readiness

compose-logs:
	$(COMPOSE) logs --follow mysql backend frontend

compose-down:
	$(COMPOSE) down --remove-orphans

k8s-render:
	node scripts/verify-k8s.mjs

k8s-build:
	./scripts/k8s-local.sh build

k8s-up:
	./scripts/k8s-local.sh up

k8s-verify:
	./scripts/k8s-local.sh verify

k8s-down:
	./scripts/k8s-local.sh down
