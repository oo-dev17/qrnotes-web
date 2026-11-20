import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { config } from './config.js';

// Reads the service account file via GOOGLE_APPLICATION_CREDENTIALS.
if (getApps().length === 0) {
  initializeApp({
    credential: applicationDefault(),
    projectId: config.firebaseWebConfig.projectId,
    storageBucket: config.firebaseWebConfig.storageBucket,
  });
}

export const adminAuth = getAuth();
export const db = getFirestore();
export const bucket = getStorage().bucket();
