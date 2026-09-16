# mobilerun app: one command to run the whole stack in development.
#
#   make setup   install Node and Python dependencies, create .env if missing
#   make dev     start the executor and the Next.js app together
#   make mongo   start MongoDB (only if you are not running it yourself)
#   make stop    stop the MongoDB started by `make mongo`
#   make test    run both test suites
#   make check   typecheck, lint and both test suites
#   make docker-build   build the all-in-one production image
#   make docker-push    build and push it (REGISTRY=ghcr.io/acme)
#   make docker-run     run the image you just built
#
# `make dev` assumes MongoDB is already reachable at MONGODB_URI. Use `make mongo`
# to start one with Docker Compose when Docker is available, otherwise with
# Homebrew's mongodb-community service. The executor always runs on the host so
# it can see USB phones.

SHELL := /bin/bash
.DEFAULT_GOAL := help

ENV_FILE ?= .env
# Values from .env are exported to every recipe; the file is optional.
ifneq (,$(wildcard $(ENV_FILE)))
  include $(ENV_FILE)
  export
endif
EXECUTOR_TOKEN ?= change-me
export EXECUTOR_TOKEN

HAS_DOCKER := $(shell command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 && echo yes)

# All-in-one production image (Dockerfile.aio). REGISTRY is the namespace to push
# to, e.g. ghcr.io/acme; without it the image is only built locally.
IMAGE ?= mobilerun
TAG ?= latest
REGISTRY ?=
IMAGE_REF := $(if $(REGISTRY),$(REGISTRY)/)$(IMAGE):$(TAG)
PLATFORMS ?= linux/amd64,linux/arm64
BUILDER ?= mobilerun-builder

# The mobilerun checkout (path is relative to api/). api/pyproject.toml already
# depends on it by path, so `uv sync` builds it from here instead of PyPI; this
# overlays an *editable* install so local edits apply without a reinstall, and
# `uv run` skips syncing so it is not reverted to the built copy.
MOBILERUN_SRC ?= mobilerun
HAS_MOBILERUN_SRC := $(shell test -f api/$(MOBILERUN_SRC)/pyproject.toml && echo yes)
UV_RUN := uv run$(if $(HAS_MOBILERUN_SRC), --no-sync)

.PHONY: help setup env mobilerun-local mongo mongo-stop executor app dev stop test test-app test-executor check clean docker-build docker-builder docker-push docker-run

help:
	@sed -n 's/^#   \(.*\)/\1/p' $(MAKEFILE_LIST) | head -9

env:
	@test -f $(ENV_FILE) || (cp .env.example $(ENV_FILE) && echo "created $(ENV_FILE); set EXECUTOR_TOKEN in it")

setup: env
	npm install
	cd api && uv sync --extra dev
	@if [ "$(HAS_MOBILERUN_SRC)" = yes ]; then $(MAKE) mobilerun-local; fi

# Install the local mobilerun checkout in editable mode.
mobilerun-local:
	cd api && uv pip install --python .venv -e $(MOBILERUN_SRC)

mongo:
ifeq ($(HAS_DOCKER),yes)
	docker compose up -d mongo
else
	@command -v brew >/dev/null || (echo "Neither Docker nor Homebrew found; start MongoDB yourself" && exit 1)
	@brew list mongodb-community >/dev/null 2>&1 || (echo "Installing MongoDB via Homebrew" && brew tap mongodb/brew && brew install mongodb-community)
	brew services start mongodb-community
endif

mongo-stop:
ifeq ($(HAS_DOCKER),yes)
	docker compose stop mongo
else
	-brew services stop mongodb-community
endif

executor:
	cd api && $(UV_RUN) mobilerun-executor

app:
	npm run dev

# Runs the executor and the app in the foreground; Ctrl+C stops both.
dev: env
	@trap 'kill 0' INT TERM EXIT; \
	  (cd api && $(UV_RUN) mobilerun-executor) & \
	  npm run dev & \
	  wait

stop: mongo-stop

test-app:
	npm test

test-executor:
	cd api && $(UV_RUN) pytest -q

test: test-app test-executor

check:
	npm run typecheck
	npm run lint
	$(MAKE) test

# Single-architecture image for the host, loaded into the local Docker daemon.
docker-build:
	docker build -f Dockerfile.aio -t $(IMAGE_REF) .

# A buildx builder that can produce both architectures.
docker-builder:
	@docker buildx inspect $(BUILDER) >/dev/null 2>&1 \
	  || docker buildx create --name $(BUILDER) --driver docker-container --bootstrap

# Multi-arch images cannot be loaded into the local daemon, so this builds and
# pushes in one step. Log in first: docker login $(firstword $(subst /, ,$(REGISTRY)))
docker-push: docker-builder
	@test -n "$(REGISTRY)" || { echo "set REGISTRY, e.g. make docker-push REGISTRY=ghcr.io/acme"; exit 1; }
	docker buildx build -f Dockerfile.aio --builder $(BUILDER) \
	  --platform $(PLATFORMS) --tag $(IMAGE_REF) --push .

docker-run:
	docker run --rm --name mobilerun -p 3000:3000 \
	  -v mobilerun-data:/data/db -v mobilerun-config:/config \
	  $(if $(OPENROUTER_API_KEY),-e OPENROUTER_API_KEY) \
	  $(IMAGE_REF)

clean:
	rm -rf .next node_modules/.cache
