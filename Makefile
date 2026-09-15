# mobilerun app: one command to run the whole stack in development.
#
#   make setup   install Node and Python dependencies, create .env if missing
#   make dev     start the executor and the Next.js app together
#   make mongo   start MongoDB (only if you are not running it yourself)
#   make stop    stop the MongoDB started by `make mongo`
#   make test    run both test suites
#   make check   typecheck, lint and both test suites
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

# Local mobilerun checkout (relative to api/). When present it is installed
# editable over the PyPI release, and `uv run` skips syncing so it is not reverted.
MOBILERUN_SRC ?= ../../../mobilerun
HAS_MOBILERUN_SRC := $(shell test -f api/$(MOBILERUN_SRC)/pyproject.toml && echo yes)
UV_RUN := uv run$(if $(HAS_MOBILERUN_SRC), --no-sync)

.PHONY: help setup env mobilerun-local mongo mongo-stop executor app dev stop test test-app test-executor check clean

help:
	@sed -n 's/^#   \(.*\)/\1/p' $(MAKEFILE_LIST) | head -6

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

clean:
	rm -rf .next node_modules/.cache
