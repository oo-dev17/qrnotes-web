import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { bucket } from '../firebase.js';
import { invalidateNote, notesCollection, requireNoteRef } from './notes.js';

export class InvalidInputError extends Error {}

export interface NoteFields {
  title: string;
  content: string;
  qrCode: string;
}

// Multipart file stream; @fastify/multipart sets truncated when fileSize was exceeded.
export type UploadStream = Readable & { truncated?: boolean };

const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

// No path segments and no control characters in file names.
function isSafeName(name: string): boolean {
  return name.length > 0 && name !== '.' && name !== '..' && !/[/\\\x00-\x1f]/.test(name);
}

function sanitizeFilename(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? '';
  const cleaned = base.replace(/[\x00-\x1f]/g, '').replace(/[/\\]/g, '_').trim().slice(0, 120);
  const withExt = cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned || 'dokument'}.pdf`;
  return withExt;
}

async function writeStream(path: string, contentType: string, file: UploadStream): Promise<void> {
  await pipeline(file, bucket.file(path).createWriteStream({ contentType, resumable: false }));
  if (file.truncated) {
    await bucket.file(path).delete({ ignoreNotFound: true });
    throw new InvalidInputError('Datei ist zu groß');
  }
}

export async function createNote(uid: string, fields: NoteFields): Promise<string> {
  const ref = notesCollection(uid).doc();
  await ref.set({
    ...fields,
    documentId: ref.id,
    galleryPic: '',
    creationDate: Date.now(),
  });
  invalidateNote(uid, ref.id);
  return ref.id;
}

export async function updateNote(uid: string, id: string, fields: NoteFields): Promise<void> {
  const ref = await requireNoteRef(uid, id);
  await ref.update({ ...fields });
  invalidateNote(uid, id);
}

export async function deleteNote(uid: string, id: string): Promise<void> {
  const ref = await requireNoteRef(uid, id);
  // Delete the document first: afterwards no Storage access via this ID is possible.
  await ref.delete();
  await bucket.deleteFiles({ prefix: `${id}/`, force: true });
  invalidateNote(uid, id);
}

export async function uploadImage(
  uid: string,
  id: string,
  file: UploadStream,
  mimetype: string,
): Promise<void> {
  await requireNoteRef(uid, id);
  const ext = IMAGE_EXT[mimetype];
  if (!ext) throw new InvalidInputError('Bildformat nicht unterstützt');
  // The name has no bearing on the order; the order comes from timeCreated.
  const path = `${id}/Images/${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
  await writeStream(path, mimetype, file);
  invalidateNote(uid, id);
}

export async function uploadDocument(
  uid: string,
  id: string,
  file: UploadStream,
  mimetype: string,
  filename: string,
): Promise<void> {
  await requireNoteRef(uid, id);
  // Some file managers and cloud apps report PDFs as application/octet-stream; then the file name counts.
  const isPdf = mimetype === 'application/pdf' || filename.toLowerCase().endsWith('.pdf');
  if (!isPdf) throw new InvalidInputError('Nur PDF-Dateien erlaubt');

  const base = sanitizeFilename(filename);
  const stem = base.slice(0, -'.pdf'.length);
  let name = base;
  for (let n = 2; (await bucket.file(`${id}/Documents/${name}`).exists())[0]; n++) {
    name = `${stem} (${n}).pdf`;
  }
  await writeStream(`${id}/Documents/${name}`, 'application/pdf', file);
  invalidateNote(uid, id);
}

export async function deleteImage(uid: string, id: string, name: string): Promise<void> {
  const ref = await requireNoteRef(uid, id);
  if (!isSafeName(name)) throw new InvalidInputError('Ungültiger Dateiname');
  await bucket.file(`${id}/Images/${name}`).delete({ ignoreNotFound: true });
  await bucket.file(`${id}/Thumbs/${name}`).delete({ ignoreNotFound: true });
  // If the image was the cover image, the selection falls back to the oldest image.
  const snap = await ref.get();
  if (snap.data()?.galleryPic === name) {
    await ref.update({ galleryPic: '' });
  }
  invalidateNote(uid, id);
}

export async function setGalleryPic(uid: string, id: string, name: string): Promise<void> {
  const ref = await requireNoteRef(uid, id);
  if (!isSafeName(name)) throw new InvalidInputError('Ungültiger Dateiname');
  const [exists] = await bucket.file(`${id}/Images/${name}`).exists();
  if (!exists) throw new InvalidInputError('Bild nicht gefunden');
  await ref.update({ galleryPic: name });
  invalidateNote(uid, id);
}

// Removes a broken galleryPic reference. Only if the saved value still matches
// what the user saw (otherwise a stale page could delete a newer cover image).
export async function clearStaleGalleryPic(uid: string, id: string, name: string): Promise<void> {
  const ref = await requireNoteRef(uid, id);
  const snap = await ref.get();
  if (snap.data()?.galleryPic === name) {
    await ref.update({ galleryPic: '' });
  }
  invalidateNote(uid, id);
}

export async function deleteDocument(uid: string, id: string, name: string): Promise<void> {
  await requireNoteRef(uid, id);
  if (!isSafeName(name)) throw new InvalidInputError('Ungültiger Dateiname');
  await bucket.file(`${id}/Documents/${name}`).delete({ ignoreNotFound: true });
  invalidateNote(uid, id);
}
