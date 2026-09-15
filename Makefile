# mobilerun app: one command to run the whole stack in development.
#
#   make setup   install Node and Python dependencies, create .env if missing
#   make dev     start MongoDB, the executor and the Next.js app together
#   make stop    stop the MongoDB started by `make dev`
#   make test    run both test suites
#   make check   typecheck, lint and both test suites
#
# MongoDB is started with Docker Compose when Docker is available, otherwise
# with Homebrew's mongodb-community service. The executor always runs on the
# host so it can see USB phones.

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

.PHONY: help setup env mongo mongo-stop executor app dev stop test test-app test-executor check clean

help:
	@sed -n 's/^#   \(.*\)/\1/p' $(MAKEFILE_LIST) | head -5

env:
	@test -f $(ENV_FILE) || (cp .env.example $(ENV_FILE) && echo "created $(ENV_FILE); set EXECUTOR_TOKEN in it")

setup: env
	npm install
	cd api && uv sync --extra dev

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
	cd api && uv run mobilerun-executor

app:
	npm run dev

# Runs the executor and the app in the foreground; Ctrl+C stops both.
dev: env mongo
	@trap 'kill 0' INT TERM EXIT; \
	  (cd api && uv run mobilerun-executor) & \
	  npm run dev & \
	  wait

stop: mongo-stop

test-app:
	npm test

test-executor:
	cd api && uv run pytest -q

test: test-app test-executor

check:
	npm run typecheck
	npm run lint
	$(MAKE) test

clean:
	rm -rf .next node_modules/.cache
