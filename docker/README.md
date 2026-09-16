# All-in-one production container

`Dockerfile.aio` builds a single image that runs the app and the executor:

| Process    | Port  | Notes                                                         |
| ---------- | ----- | ------------------------------------------------------------- |
| Next.js    | 3000  | The only published port                                       |
| executor   | 8765  | Bound to `127.0.0.1` inside the container                     |

MongoDB is not part of the image: set `MONGODB_URI` to a hosted cluster (e.g.
MongoDB Atlas) — the container refuses to start without it. For Atlas, allow the
deployment host's IP in the cluster's network access list.

`supervisord` (under `tini`) starts the executor, then the app. If either gives up
restarting, the container exits so your orchestrator restarts it.

## Build and run

The build context is filtered by `Dockerfile.aio.dockerignore`, which BuildKit (the
default builder) picks up automatically.

```bash
docker build -f Dockerfile.aio -t mobilerun:latest .

docker run -d --name mobilerun -p 3000:3000 \
  -v mobilerun-config:/config \
  -e MONGODB_URI='mongodb+srv://user:pass@cluster.example.mongodb.net/' \
  -e OPENROUTER_API_KEY=... \
  --restart unless-stopped \
  mobilerun:latest
```

Or `docker compose -f docker-compose.prod.yml up -d --build`, or through the Makefile:

```bash
make docker-build                          # mobilerun:latest for this host's architecture
make docker-run                            # run it, passing MONGODB_URI and OPENROUTER_API_KEY from .env
make docker-push REGISTRY=ghcr.io/acme     # linux/amd64 + linux/arm64, built and pushed
make docker-push REGISTRY=ghcr.io/acme TAG=v1.0.0 PLATFORMS=linux/amd64
```

`docker login ghcr.io` first. A multi-architecture image cannot be loaded into the
local daemon, so `docker-push` builds and pushes in one step through a buildx
builder it creates on first use (`mobilerun-builder`); `IMAGE`, `TAG`, `PLATFORMS`
and `BUILDER` are all overridable.

The app is on <http://localhost:3000>. Put it behind a TLS-terminating reverse
proxy before exposing it: the app has no authentication of its own.

## Publishing from CI

[`.github/workflows/docker.yml`](../.github/workflows/docker.yml) builds `Dockerfile.aio`
for `linux/amd64` and `linux/arm64` and pushes it to this repository's GitHub
Container Registry:

| Trigger                | Tags                                  |
| ---------------------- | ------------------------------------- |
| push to `main`         | `main`, `sha-<short>`, `latest`       |
| push of a `v*` tag     | `1.2.3`, `1.2`, `latest`              |
| pull request           | amd64 build only, nothing pushed      |
| manual run             | as above, `platforms` is an input     |

It needs no secrets — the built-in `GITHUB_TOKEN` pushes to `ghcr.io` — and each
published image gets a signed build provenance attestation. Deploying then means:

```bash
docker pull ghcr.io/<owner>/<repo>:latest
```

GHCR packages start out private, so either make the package public in the
repository's package settings or `docker login ghcr.io` on the deployment host
with a token that has `read:packages`.

## Configuration

| Variable                   | Default                                | Meaning                                                              |
| -------------------------- | -------------------------------------- | -------------------------------------------------------------------- |
| `EXECUTOR_TOKEN`           | generated at start                     | Shared secret between app and executor; both live in this container   |
| `MONGODB_URI`              | required                               | MongoDB connection string, e.g. `mongodb+srv://…` for Atlas          |
| `MONGODB_DB`               | `mobilerun`                            | Database name                                                        |
| `MOBILERUN_CONFIG`         | `/config/config.yaml`                  | Framework config; seeded from the bundled default on first start     |
| `OPENROUTER_API_KEY`       | unset                                  | Provider key for the models in the framework config                  |

The framework config lands in the `/config` volume on first start. Edit it there
(`docker exec -it mobilerun vi /config/config.yaml`) and restart the container —
model choice, agent settings and app cards all come from that file.

## Phones

- **Network adb** works anywhere: `docker exec mobilerun adb connect <phone-ip>:5555`.
- **USB on a Linux host**: run with `--privileged --device /dev/bus/usb:/dev/bus/usb`
  (or the `privileged`/`devices` lines in `docker-compose.prod.yml`). Docker Desktop
  on macOS and Windows cannot pass USB through — use network adb there.

## Operating it

```bash
docker logs -f mobilerun                       # both processes, one stream
docker exec mobilerun supervisorctl status     # per-process state
docker exec mobilerun supervisorctl restart executor
docker exec mobilerun adb devices              # what the executor can see
```

The image runs as root by default so adb can reach USB devices. For a
network-adb-only deployment, add `--user 1000:1000`; `/config` and `/srv` are
owned by that uid.

Every task, schedule and run lives in MongoDB, so backups are the cluster's job
(Atlas snapshots, or `mongodump` against `MONGODB_URI`).

## Size

The image is large (roughly 2 GB): the framework pulls in llama-index and
arize-phoenix, and the Node and Python runtimes sit in one layer set.
That is the cost of one container holding everything.
