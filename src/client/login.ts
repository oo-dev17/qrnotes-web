import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';

const button = document.getElementById('login-btn') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLParagraphElement;

const firebaseConfig = JSON.parse(button.dataset.firebaseConfig ?? '{}');
const auth = getAuth(initializeApp(firebaseConfig));
const provider = new GoogleAuthProvider();

function setStatus(text: string): void {
  status.textContent = text;
}

button.addEventListener('click', async () => {
  button.disabled = true;
  setStatus('Anmeldung läuft …');
  try {
    const result = await signInWithPopup(auth, provider);
    const idToken = await result.user.getIdToken();

    const res = await fetch('/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken }),
      credentials: 'same-origin',
    });
    if (!res.ok) {
      throw new Error(`Server antwortet mit ${res.status}`);
    }
    window.location.assign('/');
  } catch (err) {
    console.error('Login fehlgeschlagen:', err);
    const code = (err as { code?: string }).code ?? String(err);
    setStatus(`Anmeldung fehlgeschlagen: ${code}`);
    button.disabled = false;
  }
});
