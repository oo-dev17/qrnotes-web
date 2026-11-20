# QrNotes Web

Web copy of the QrNotes Android app. Same Firebase project (qrnotes-f41bf).

## Stack
Node 22, TypeScript, Fastify, Eta templates, htmx, Tailwind, firebase-admin.
Runs as a Docker container on Synology (reverse proxy, HTTPS). Mobile-first, PWA.

## Data model
- Firestore: users/{uid}/qrNotes/{docId}
  Fields: title, content, creationDate (ms), qrCode, documentId, galleryPic (file name)
  Ignore `allDocuments`.
- Storage bucket qrnotes-f41bf.firebasestorage.app:
  {docId}/Images/*, {docId}/Documents/* (PDFs)
- Access only via Admin SDK. Before every Storage access, check that
  users/{uid}/qrNotes/{docId} exists (the Storage path contains no uid).
- Deliver files via signed URLs (v4, 1 h).

## Auth
Firebase JS SDK Google login in the browser -> ID token to server -> createSessionCookie
(httpOnly, secure). Every route except /login checks the cookie.

## UI
List: thumbnail (galleryPic), title, documentId, qrCode, search field (filter in the
server cache, 5 min), buttons QR scan and New. Detail: text, image gallery, PDFs.


## Order
1. Login + session
2. List + search
3. Detail with images/PDF
4. QR scan (code -> open note)
5. Dockerfile + compose

## Rules
- No secrets in code or Git (.env, secrets/ in .gitignore).
- No Firebase Admin or Claude key in the browser.
- Keep Firestore reads low, cache lists.
- Claude API (if used): Haiku, limit max_tokens, prompt caching.
- Always small steps, then test that it runs.

## Order
1. Login + session  2. List + search  3. Detail with images/PDF
4. Create/edit/delete  5. QR scan  6. Dockerfile + compose
