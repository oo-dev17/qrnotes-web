# QrNotes Web

Web version of the QrNotes Android app. It uses the same Firebase project.
It runs as a Docker container on a Synology NAS behind a reverse proxy with HTTPS.

## Stack

Node 22, TypeScript, Fastify, Eta templates, htmx, Tailwind, firebase-admin.

## Requirements

- A Firebase project with Firestore, Storage and Google sign-in (Authentication)
- A service account key for the project (Firebase console → Project settings → Service accounts → Generate new private key)
- A Synology NAS with DSM 7.2 or newer and the **Container Manager** package
- A domain with an HTTPS certificate for the reverse proxy (e.g. Let's Encrypt via DSM)

## Local development

```bash
npm ci
cp .env.example .env        # fill in the values
mkdir -p secrets            # put serviceAccount.json here
npm run dev
```

## Installation on the Synology NAS

Run all commands on the **NAS host** (over SSH), not inside the container. Docker Compose builds the image and starts the container.

### 1. Get the project onto the NAS

Over SSH (Git must be available on the NAS), or via File Station:

```bash
sudo mkdir -p /volume1/docker
cd /volume1/docker
sudo git clone https://github.com/<user>/qrnotes-web.git qrnotes
cd qrnotes
```

### 2. Place the secret files (not in Git)

Two files must be copied into the project directory by hand:

- `.env` – a copy of `.env.example` with the Firebase values and `PORT`
- `secrets/serviceAccount.json` – the service account key

```bash
sudo mkdir -p secrets
# copy the files to /volume1/docker/qrnotes, e.g. with File Station
```

### 3. Build and start the container

```bash
cd /volume1/docker/qrnotes
sudo docker compose up -d --build
```

Check it:

```bash
sudo docker compose ps
sudo docker compose logs -f
```

Then `http://<NAS-IP>:8090/login` should show the login page.

Alternatively, use the UI: Container Manager → Project → Create → path `/volume1/docker/qrnotes` → Create and start.

### 4. Reverse proxy and HTTPS

- DSM → Control Panel → Login Portal → Advanced → Reverse Proxy → Create:
  - Source: `https://<your-domain>:443`
  - Destination: `http://localhost:8090`
- Assign a certificate for the domain (Control Panel → Security → Certificate).
- In the Firebase console, go to Authentication → Settings → Authorized domains and add the domain. Without this, Google sign-in fails.

### 5. Install updates

On the NAS host:

```bash
cd /volume1/docker/qrnotes
sudo git pull
sudo docker compose up -d --build
sudo docker image prune -f      # remove old images (optional)
```

Only `.env` changed? Then `sudo docker compose up -d` without `--build` is enough.

## Operations

| Task | Command (on the NAS host) |
|---|---|
| Status | `sudo docker compose ps` |
| Logs | `sudo docker compose logs -f` |
| Restart | `sudo docker compose restart` |
| Stop | `sudo docker compose down` |

The container starts automatically after a NAS reboot (`restart: unless-stopped`).

## Configuration

| Variable | Meaning |
|---|---|
| `PORT` | Port inside the container (default 3000) |
| `FIREBASE_*` | Web configuration from the Firebase project settings |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to the service account key (set to the container path in `compose.yaml`) |

## License

Private, no license.
