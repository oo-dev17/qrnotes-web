import { existsSync } from 'node:fs';

// .env is only loaded locally. In the container, the variables come from the Compose file.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Umgebungsvariable fehlt: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  isProduction: process.env.NODE_ENV === 'production',
  firebaseWebConfig: {
    apiKey: required('FIREBASE_API_KEY'),
    authDomain: required('FIREBASE_AUTH_DOMAIN'),
    projectId: required('FIREBASE_PROJECT_ID'),
    storageBucket: required('FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: required('FIREBASE_MESSAGING_SENDER_ID'),
    appId: required('FIREBASE_APP_ID'),
  },
} as const;

export const SESSION_COOKIE = 'session';
export const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000; // 5 days
