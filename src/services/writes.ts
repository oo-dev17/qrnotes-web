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

// Multipart-Dateistrom; @fastify/multipart setzt truncated, wenn fileSize überschritten wurde.
export type UploadStream = Readable & { truncated?: boolean };

const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

// Keine Pfadangaben und keine Steuerzeichen in Dateinamen.
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
  // Erst das Dokument löschen: danach ist kein Storage-Zugriff über diese ID mehr möglich.
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
  // Name trägt keine Bedeutung für die Reihenfolge; die kommt aus timeCreated.
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
  // Manche Dateimanager und Cloud-Apps melden PDFs als application/octet-stream; dann zählt der Dateiname.
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
  // War das Bild das Titelbild, fällt die Auswahl auf das älteste Bild zurück.
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

// Entfernt einen kaputten galleryPic-Verweis. Nur wenn der gespeicherte Wert noch dem entspricht,
// den der Nutzer gesehen hat (sonst könnte eine veraltete Seite ein neueres Titelbild löschen).
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
