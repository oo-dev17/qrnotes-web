import type { DocumentReference } from 'firebase-admin/firestore';
import { bucket, db } from '../firebase.js';
import { fingerprint, listFingerprint } from './fingerprint.js';

export interface NoteSummary {
  id: string;
  title: string;
  documentId: string;
  qrCode: string;
  creationDate: number;
  thumbUrl: string | null;
  imageCount: number;
  pdfCount: number;
  content: string; // full text, used for the search only (not rendered in the list)
  excerpt: string; // first 10 characters of the text, whitespace collapsed
  fp: string; // Fingerprint of the Firestore fields (see fingerprint.ts)
}

export interface StoredFile {
  name: string;
  url: string;
  timeCreated: number;
}

export interface NoteDetail {
  id: string;
  title: string;
  content: string;
  qrCode: string;
  images: StoredFile[]; // by capture time, oldest first
  documents: StoredFile[];
  coverName: string | null; // galleryPic, otherwise the oldest image
  staleCover: string | null; // galleryPic whose file is missing (broken reference)
  fingerprint: string; // Firestore fields of the note (see fingerprint.ts)
  hasSketch: boolean; // {docId}/Sketch/sketch.json exists
  hasSketchPreview: boolean; // {docId}/Sketch/preview.png exists
}

export class NoteNotFoundError extends Error {
  constructor() {
    super('Note not found');
  }
}

const LIST_TTL_MS = 5 * 60 * 1000;
const DETAIL_TTL_MS = 5 * 60 * 1000;
const SIGNED_URL_TTL_MS = 60 * 60 * 1000; // 1 h
const IGNORED_DOC_IDS = new Set(['allDocuments']);
const VALID_ID = /^[A-Za-z0-9_-]{1,128}$/;

interface Cached<T> {
  loadedAt: number;
  value: T;
}

// Per user: list (for search) and per note: detail. Changes invalidate via invalidateNote().
const listCache = new Map<string, Cached<NoteSummary[]>>();
const detailCache = new Map<string, Cached<NoteDetail>>();

export function notesCollection(uid: string) {
  return db.collection('users').doc(uid).collection('qrNotes');
}

// Checks existence and ownership (path contains the uid). Only after that may Storage be accessed.
export async function requireNoteRef(uid: string, id: string): Promise<DocumentReference> {
  if (!VALID_ID.test(id)) throw new NoteNotFoundError();
  const ref = notesCollection(uid).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new NoteNotFoundError();
  return ref;
}

export function invalidateNote(uid: string, id: string): void {
  listCache.delete(uid);
  detailCache.delete(`${uid}/${id}`);
}

type StorageFile = ReturnType<typeof bucket.file>;

function timeOf(file: { metadata?: { timeCreated?: string } }): number {
  const t = file.metadata?.timeCreated;
  return t ? Date.parse(t) : 0;
}

async function listImages(id: string): Promise<StorageFile[]> {
  const [files] = await bucket.getFiles({ prefix: `${id}/Images/` });
  return files.filter((f) => !f.name.endsWith('/'));
}

async function signedUrl(file: StorageFile): Promise<string> {
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + SIGNED_URL_TTL_MS,
  });
  return url;
}

// First 10 characters of the text for the list (code points, so emoji are not split).
function excerptOf(content: string): string {
  const chars = [...content.replace(/\s+/g, ' ').trim()];
  return chars.length > 10 ? chars.slice(0, 10).join('') + '…' : chars.join('');
}

// List: galleryPic if the file exists; otherwise the oldest image (same as on the detail page).
// Returns the app's own thumbnail route (cached in the browser and in Storage), not a full-size URL.
function listThumbUrl(id: string, images: StorageFile[], galleryPic: string): string | null {
  if (images.length === 0) return null;
  const cover = images.find((f) => f.name === `${id}/Images/${galleryPic}`)
    ?? images.reduce((a, b) => (timeOf(b) < timeOf(a) ? b : a));
  const name = cover.name.slice(`${id}/Images/`.length);
  return `/notes/${encodeURIComponent(id)}/thumb/${encodeURIComponent(name)}`;
}

async function loadNotes(uid: string): Promise<NoteSummary[]> {
  const snapshot = await notesCollection(uid)
    .select('title', 'content', 'documentId', 'qrCode', 'galleryPic', 'creationDate')
    .get();

  const notes = await Promise.all(
    snapshot.docs
      .filter((doc) => !IGNORED_DOC_IDS.has(doc.id))
      .map(async (doc): Promise<NoteSummary> => {
        const data = doc.data();
        const galleryPic = typeof data.galleryPic === 'string' ? data.galleryPic : '';
        const content = typeof data.content === 'string' ? data.content : '';
        // Storage listing (not cached per note; the list itself is cached for LIST_TTL_MS).
        const [images, documents] = await Promise.all([
          listImages(doc.id),
          listDocumentFiles(doc.id),
        ]);
        return {
          id: doc.id,
          title: typeof data.title === 'string' ? data.title : '',
          // If documentId is missing, the Android app shows the document ID; we do the same here.
          documentId: typeof data.documentId === 'string' && data.documentId ? data.documentId : doc.id,
          qrCode: typeof data.qrCode === 'string' ? data.qrCode : '',
          creationDate: typeof data.creationDate === 'number' ? data.creationDate : 0,
          thumbUrl: listThumbUrl(doc.id, images, galleryPic),
          imageCount: images.length,
          pdfCount: documents.length,
          content,
          excerpt: excerptOf(content),
          fp: fingerprint(data),
        };
      }),
  );

  return notes.sort((a, b) => b.creationDate - a.creationDate);
}

async function getAllNotes(uid: string): Promise<NoteSummary[]> {
  const cached = listCache.get(uid);
  if (cached && Date.now() - cached.loadedAt < LIST_TTL_MS) {
    return cached.value;
  }
  const notes = await loadNotes(uid);
  listCache.set(uid, { loadedAt: Date.now(), value: notes });
  return notes;
}

export const SORT_ORDERS = ['date-desc', 'date-asc', 'name-asc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export function parseSort(value: unknown): SortOrder {
  return (SORT_ORDERS as readonly string[]).includes(value as string)
    ? (value as SortOrder)
    : 'date-desc';
}

function sortNotes(notes: NoteSummary[], sort: SortOrder): NoteSummary[] {
  const copy = [...notes];
  switch (sort) {
    case 'date-asc':
      return copy.sort((a, b) => a.creationDate - b.creationDate);
    case 'name-asc':
      // Notes without a title go to the end.
      return copy.sort((a, b) => {
        if (!a.title !== !b.title) return a.title ? -1 : 1;
        return a.title.localeCompare(b.title, 'de', { sensitivity: 'base' });
      });
    case 'date-desc':
    default:
      return copy.sort((a, b) => b.creationDate - a.creationDate);
  }
}

// Filters by title, text, documentId and qrCode (case-insensitive) and sorts afterwards.
export async function searchNotes(
  uid: string,
  query: string,
  sort: SortOrder = 'date-desc',
): Promise<NoteSummary[]> {
  const notes = await getAllNotes(uid);
  const q = query.trim().toLowerCase();
  const matches = q
    ? notes.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q) ||
          n.documentId.toLowerCase().includes(q) ||
          n.qrCode.toLowerCase().includes(q),
      )
    : notes;
  return sortNotes(matches, sort);
}

// Fingerprint of the whole list (all notes, regardless of search).
export async function listFingerprintFor(uid: string): Promise<string> {
  const notes = await getAllNotes(uid);
  return listFingerprint(notes.map((n) => [n.id, n.fp]));
}

// Files of a note as keys ('I/name' = image, 'D/name' = PDF), for the live comparison.
export function fileKeys(
  images: { name: string }[],
  documents: { name: string }[],
  hasSketch: boolean,
): string[] {
  const keys = [...images.map((i) => `I/${i.name}`), ...documents.map((d) => `D/${d.name}`)];
  if (hasSketch) keys.push('S/sketch.json');
  return keys.sort();
}

// Reads the files directly from Storage (no cache). Only call after the ownership check.
export async function listFileKeys(id: string): Promise<string[]> {
  const [images] = await bucket.getFiles({ prefix: `${id}/Images/` });
  const [documents] = await bucket.getFiles({ prefix: `${id}/Documents/` });
  const [sketch] = await bucket.file(`${id}/Sketch/sketch.json`).exists();
  return fileKeys(
    images
      .filter((f) => !f.name.endsWith('/'))
      .map((f) => ({ name: f.name.slice(`${id}/Images/`.length) })),
    documents
      .filter((f) => !f.name.endsWith('/'))
      .map((f) => ({ name: f.name.slice(`${id}/Documents/`.length) })),
    sketch,
  );
}

// Exact match on qrCode (for the scanner). With multiple matches, the newest note wins.
export async function findNoteByQrCode(
  uid: string,
  code: string,
  exceptId?: string,
): Promise<NoteSummary | null> {
  const value = code.trim();
  if (!value) return null;
  const notes = await getAllNotes(uid);
  return notes.find((n) => n.qrCode === value && n.id !== exceptId) ?? null;
}

async function listDocumentFiles(id: string): Promise<StorageFile[]> {
  const [files] = await bucket.getFiles({ prefix: `${id}/Documents/` });
  return files.filter((f) => !f.name.endsWith('/'));
}

async function listDocuments(id: string): Promise<StoredFile[]> {
  const prefix = `${id}/Documents/`;
  const files = await listDocumentFiles(id);
  return Promise.all(
    files.map(async (file) => ({
      name: file.name.slice(prefix.length),
      url: await signedUrl(file),
      timeCreated: timeOf(file),
    })),
  );
}

// Detail page. Cached; the existence check runs on load, write access invalidates the entry.
export async function getNoteDetail(uid: string, id: string): Promise<NoteDetail | null> {
  if (!VALID_ID.test(id)) return null;
  const key = `${uid}/${id}`;
  const cached = detailCache.get(key);
  if (cached && Date.now() - cached.loadedAt < DETAIL_TTL_MS) {
    return cached.value;
  }

  const snap = await notesCollection(uid).doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  const galleryPic = typeof data.galleryPic === 'string' ? data.galleryPic : '';

  // Storage only after the existence check above.
  const imageFiles = await listImages(id);
  const images: StoredFile[] = await Promise.all(
    imageFiles.map(async (file) => ({
      name: file.name.slice(`${id}/Images/`.length),
      url: await signedUrl(file),
      timeCreated: timeOf(file),
    })),
  );
  images.sort((a, b) => a.timeCreated - b.timeCreated);

  const documents = (await listDocuments(id)).sort((a, b) => a.name.localeCompare(b.name));
  const [hasSketch] = await bucket.file(`${id}/Sketch/sketch.json`).exists();
  const [hasSketchPreview] = await bucket.file(`${id}/Sketch/preview.png`).exists();

  const galleryExists = images.some((i) => i.name === galleryPic);
  const coverName = galleryExists ? galleryPic : (images[0]?.name ?? null);
  const staleCover = galleryPic && !galleryExists ? galleryPic : null;

  const detail: NoteDetail = {
    id: snap.id,
    title: typeof data.title === 'string' ? data.title : '',
    content: typeof data.content === 'string' ? data.content : '',
    qrCode: typeof data.qrCode === 'string' ? data.qrCode : '',
    images,
    documents,
    coverName,
    staleCover,
    fingerprint: fingerprint(data),
    hasSketch,
    hasSketchPreview,
  };
  detailCache.set(key, { loadedAt: Date.now(), value: detail });
  return detail;
}
