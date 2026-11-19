import { startLivePoll } from './live.js';

// Detailseite: Änderungen an der Notiz oder an ihren Dateien (Storage) melden.
const page = document.querySelector<HTMLElement>('[data-live-url]');
if (page) {
  const initialFp = page.dataset.liveFp ?? '';
  const initialFiles = page.dataset.liveFiles ?? '[]';
  startLivePoll(page.dataset.liveUrl ?? '', (data) => {
    return String(data.fp) !== initialFp || JSON.stringify(data.files) !== initialFiles;
  });
}

// Dateiauswahl startet den Upload sofort. Während des Uploads zeigt das Element „Lädt…“.
// Diagnose: der Status-Text am Button zeigt, was der Browser erkannt hat (ohne Konsole am Handy lesbar).
document.querySelectorAll<HTMLInputElement>('input.js-autoupload').forEach((input) => {
  const label = input.closest<HTMLElement>('.js-upload');
  const text = label?.querySelector<HTMLElement>('.js-upload-text');
  const show = (msg: string) => {
    if (text) text.textContent = msg;
  };

  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []);
    console.info('[upload] change', input.name, files.map((f) => `${f.name} | ${f.type} | ${f.size}`));
    if (files.length === 0) {
      show('Keine Datei erkannt – bitte erneut wählen');
      return;
    }
    if (!input.form) {
      console.error('[upload] kein Formular gefunden');
      show('Fehler: kein Formular');
      return;
    }
    const more = files.length > 1 ? ` (+${files.length - 1})` : '';
    show(`Lädt hoch: ${files[0].name}${more} …`);
    label?.classList.add('pointer-events-none', 'opacity-50');
    input.form.submit();
  });
});

// Vollbild-Ansicht für Bilder in der Detailseite.
const viewer = document.getElementById('image-viewer') as HTMLDialogElement | null;
const viewerImg = document.getElementById('image-viewer-img') as HTMLImageElement | null;
const closeButton = document.getElementById('image-viewer-close') as HTMLButtonElement | null;

if (viewer && viewerImg && closeButton) {
  document.querySelectorAll<HTMLButtonElement>('.js-open-image').forEach((button) => {
    button.addEventListener('click', () => {
      viewerImg.src = button.dataset.full ?? '';
      viewerImg.alt = button.dataset.name ?? '';
      viewer.showModal();
    });
  });

  closeButton.addEventListener('click', () => viewer.close());
  // Ein Tipp irgendwo im Vollbild schließt die Ansicht.
  viewer.addEventListener('click', () => viewer.close());
  viewer.addEventListener('close', () => {
    viewerImg.removeAttribute('src');
  });
}
