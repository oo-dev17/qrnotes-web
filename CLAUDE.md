# QrNotes Web

Web-Kopie der Android-App QrNotes. Gleiches Firebase-Projekt (qrnotes-f41bf).

## Stack
Node 22, TypeScript, Fastify, Eta-Templates, htmx, Tailwind, firebase-admin.
Läuft als Docker-Container auf Synology (Reverse Proxy, HTTPS). Mobile-first, PWA.

## Datenmodell
- Firestore: users/{uid}/qrNotes/{docId}
  Felder: title, content, creationDate (ms), qrCode, documentId, galleryPic (Dateiname)
  `allDocuments` ignorieren.
- Storage-Bucket qrnotes-f41bf.firebasestorage.app:
  {docId}/Images/*, {docId}/Documents/* (PDFs)
- Zugriff nur über Admin SDK. Vor jedem Storage-Zugriff prüfen, dass
  users/{uid}/qrNotes/{docId} existiert (Storage-Pfad enthält keine uid).
- Dateien über Signed URLs (v4, 1 h) ausliefern.

## Auth
Firebase JS SDK Google-Login im Browser -> ID-Token an Server -> createSessionCookie
(httpOnly, secure). Jede Route außer /login prüft das Cookie.

## UI
Liste: Thumbnail (galleryPic), Titel, documentId, qrCode, Suchfeld (Filter im
Server-Cache, 5 Min), Buttons QR-Scan und Neu. Detail: Text, Bildergalerie, PDFs.


## Reihenfolge
1. Login + Session
2. Liste + Suche
3. Detail mit Bildern/PDF
4. QR-Scan (Code -> Notiz öffnen)
5. Dockerfile + compose

## Regeln
- Keine Secrets im Code oder Git (.env, secrets/ in .gitignore).
- Kein Firebase-Admin- oder Claude-Key im Browser.
- Firestore-Reads sparsam halten, Listen cachen.
- Claude-API (falls genutzt): Haiku, max_tokens begrenzen, Prompt Caching.
- Immer kleine Schritte, danach lauffähig testen.

## Reihenfolge
1. Login + Session  2. Liste + Suche  3. Detail mit Bildern/PDF
4. Anlegen/Bearbeiten/Löschen  5. QR-Scan  6. Dockerfile + compose