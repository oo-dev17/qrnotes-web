# QrNotes Web

Web-Version der Android-App QrNotes. Nutzt dasselbe Firebase-Projekt.
Läuft als Docker-Container auf einem Synology-NAS hinter einem Reverse Proxy mit HTTPS.

## Stack

Node 22, TypeScript, Fastify, Eta-Templates, htmx, Tailwind, firebase-admin.

## Voraussetzungen

- Firebase-Projekt mit Firestore, Storage und Google-Login (Authentication)
- Service-Account-Schlüssel für das Projekt (Firebase-Konsole → Projekteinstellungen → Dienstkonten → Neuen privaten Schlüssel erzeugen)
- Synology-NAS mit DSM 7.2 oder neuer und dem Paket **Container Manager**
- Eine Domain mit HTTPS-Zertifikat für den Reverse Proxy (z. B. Let's Encrypt über DSM)

## Lokal entwickeln

```bash
npm ci
cp .env.example .env        # Werte eintragen
mkdir -p secrets            # serviceAccount.json hier ablegen
npm run dev
```

## Installation auf dem Synology-NAS

Alle Befehle laufen auf dem **NAS-Host** (per SSH), nicht im Container. Der Container wird von Docker Compose aus dem Image gebaut und gestartet.

### 1. Projekt auf das NAS bringen

Per SSH (Git muss auf dem NAS verfügbar sein) oder über File Station:

```bash
sudo mkdir -p /volume1/docker
cd /volume1/docker
sudo git clone https://github.com/<benutzer>/qrnotes-web.git qrnotes
cd qrnotes
```

### 2. Geheime Dateien ablegen (nicht in Git)

Zwei Dateien müssen von Hand in das Projektverzeichnis kopiert werden:

- `.env` – Kopie von `.env.example` mit den Firebase-Werten und `PORT`
- `secrets/serviceAccount.json` – der Service-Account-Schlüssel

```bash
sudo mkdir -p secrets
# Dateien z. B. per File Station nach /volume1/docker/qrnotes kopieren
```

### 3. Container bauen und starten

```bash
cd /volume1/docker/qrnotes
sudo docker compose up -d --build
```

Prüfen:

```bash
sudo docker compose ps
sudo docker compose logs -f
```

Danach sollte `http://<NAS-IP>:8090/login` die Login-Seite zeigen.

Alternativ über die Oberfläche: Container Manager → Projekt → Erstellen → Pfad `/volume1/docker/qrnotes` → Erstellen und Starten.

### 4. Reverse Proxy und HTTPS

- DSM → Systemsteuerung → Anmeldeportal → Erweitert → Reverse Proxy → Erstellen:
  - Quelle: `https://<deine-domain>:443`
  - Ziel: `http://localhost:8090`
- Zertifikat für die Domain hinterlegen (Systemsteuerung → Sicherheit → Zertifikat).
- In der Firebase-Konsole unter Authentication → Settings → Authorized domains die Domain eintragen. Ohne diesen Eintrag schlägt der Google-Login fehl.

### 5. Updates einspielen

Auf dem NAS-Host:

```bash
cd /volume1/docker/qrnotes
sudo git pull
sudo docker compose up -d --build
sudo docker image prune -f      # alte Images entfernen (optional)
```

Nur `.env` geändert? Dann genügt `sudo docker compose up -d` ohne `--build`.

## Betrieb

| Aufgabe | Befehl (auf dem NAS-Host) |
|---|---|
| Status | `sudo docker compose ps` |
| Logs | `sudo docker compose logs -f` |
| Neustart | `sudo docker compose restart` |
| Stoppen | `sudo docker compose down` |

Der Container startet nach einem NAS-Neustart automatisch (`restart: unless-stopped`).

## Konfiguration

| Variable | Bedeutung |
|---|---|
| `PORT` | Port im Container (Standard 3000) |
| `FIREBASE_*` | Web-Konfiguration aus den Firebase-Projekteinstellungen |
| `GOOGLE_APPLICATION_CREDENTIALS` | Pfad zum Service-Account-Schlüssel (in `compose.yaml` auf den Container-Pfad gesetzt) |

## Lizenz

Privat, keine Lizenz.
