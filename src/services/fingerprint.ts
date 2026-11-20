import { createHash } from 'node:crypto';

// Fingerprint over the Firestore fields of a note. Identical data always yields the same value,
// regardless of whether they come from a read, the cache or the listener.
export function fingerprint(data: Record<string, unknown>): string {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  const payload = JSON.stringify([
    str(data.title),
    str(data.content),
    str(data.qrCode),
    str(data.galleryPic),
    str(data.documentId),
    num(data.creationDate),
  ]);
  return createHash('sha1').update(payload).digest('hex').slice(0, 16);
}

// Fingerprint of the whole list: depends on all notes (ID + fingerprint).
export function listFingerprint(entries: Array<[string, string]>): string {
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash('sha1').update(JSON.stringify(sorted)).digest('hex').slice(0, 16);
}
