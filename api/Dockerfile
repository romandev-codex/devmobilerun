FROM python:3.13-slim

# adb is needed for wifi-connected phones; USB passthrough is not available on macOS hosts.
RUN apt-get update \
    && apt-get install -y --no-install-recommends android-tools-adb ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /srv/executor
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY executor ./executor
RUN uv sync --frozen --no-dev

ENV EXECUTOR_HOST=0.0.0.0 EXECUTOR_PORT=8765 MOBILERUN_STREAM_SCREENSHOTS=1
EXPOSE 8765
CMD ["uv", "run", "--no-sync", "mobilerun-executor"]
