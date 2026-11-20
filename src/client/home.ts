import { startLivePoll } from './live.js';

const logoutButton = document.getElementById('logout-btn') as HTMLButtonElement;

// List: report changes from web or Android (fingerprint of the whole list).
const noteList = document.getElementById('note-list');
const listFp = noteList?.dataset.liveFp ?? '';
startLivePoll('/live/list', (data) => String(data.fp) !== listFp);

logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
  window.location.assign('/login');
});

// Close menu: tap outside the menu or Escape.
const menu = document.getElementById('main-menu') as HTMLDetailsElement | null;
if (menu) {
  document.addEventListener('click', (event) => {
    if (menu.open && !menu.contains(event.target as Node)) {
      menu.open = false;
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') menu.open = false;
  });
}
