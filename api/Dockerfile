FROM python:3.13-slim

# adb is needed for wifi-connected phones; USB passthrough is not available on macOS hosts.
RUN apt-get update \
    && apt-get install -y --no-install-recommends android-tools-adb ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# The mobilerun framework is a path dependency (see [tool.uv.sources] in
# pyproject.toml), so its source has to be in place before the sync. hatchling
# needs only the package plus pyproject.toml and README.md to build the wheel.
WORKDIR /srv/executor
COPY mobilerun/pyproject.toml mobilerun/README.md ./mobilerun/
COPY mobilerun/mobilerun ./mobilerun/mobilerun
COPY pyproject.toml uv.lock ./
# The cache mount keeps rebuilds cheap: editing mobilerun invalidates this layer,
# but the third-party wheels are unpacked from the uv cache rather than
# re-downloaded. It is build-only state and never lands in the image.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project
COPY executor ./executor
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

ENV EXECUTOR_HOST=0.0.0.0 EXECUTOR_PORT=8765 MOBILERUN_STREAM_SCREENSHOTS=1
EXPOSE 8765
CMD ["uv", "run", "--no-sync", "mobilerun-executor"]
