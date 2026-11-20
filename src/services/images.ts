import sharp from 'sharp';
import { bucket } from '../firebase.js';
import { NoteNotFoundError, requireNoteRef } from './notes.js';

// Thumbnails are cached next to the original: {docId}/Thumbs/{name}.
// They are created on first request and served from Storage afterwards.
const THUMB_WIDTH = 480;
const THUMB_QUALITY = 80;

export interface ImageBytes {
  body: Buffer;
  contentType: string;
}

// Checks ownership via Firestore (users/{uid}/qrNotes/{id}) before Storage is touched.
export async function getThumb(uid: string, id: string, name: string): Promise<ImageBytes> {
  if (!name || name === '.' || name === '..' || /[/\\]/.test(name)) {
    throw new NoteNotFoundError();
  }
  await requireNoteRef(uid, id);
  const original = bucket.file(`${id}/Images/${name}`);
  const thumb = bucket.file(`${id}/Thumbs/${name}`);

  const [cached] = await thumb.exists();
  if (cached) {
    const [body] = await thumb.download();
    return { body, contentType: 'image/jpeg' };
  }

  const [originalBody] = await original.download();
  let resized: Buffer;
  try {
    resized = await sharp(originalBody)
      .rotate() // apply EXIF orientation (phone photos)
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: THUMB_QUALITY })
      .toBuffer();
  } catch {
    // Format not readable by sharp (e.g. HEIC without a decoder): serve the original.
    const [meta] = await original.getMetadata();
    return { body: originalBody, contentType: meta.contentType ?? 'application/octet-stream' };
  }

  await thumb.save(resized, { contentType: 'image/jpeg', resumable: false });
  return { body: resized, contentType: 'image/jpeg' };
}
