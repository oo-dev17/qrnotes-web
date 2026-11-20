import { startLivePoll } from './live.js';

// Detail page: report changes to the note or its files (Storage).
const page = document.querySelector<HTMLElement>('[data-live-url]');
if (page) {
  const initialFp = page.dataset.liveFp ?? '';
  const initialFiles = page.dataset.liveFiles ?? '[]';
  startLivePoll(page.dataset.liveUrl ?? '', (data) => {
    return String(data.fp) !== initialFp || JSON.stringify(data.files) !== initialFiles;
  });
}

// File selection starts the upload immediately. While uploading, the element shows 'Loading…'.
// Diagnostics: the status text on the button shows what the browser detected (readable on a phone without a console).
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
      show('No file detected – please choose again');
      return;
    }
    if (!input.form) {
      console.error('[upload] no form found');
      show('Error: no form');
      return;
    }
    const more = files.length > 1 ? ` (+${files.length - 1})` : '';
    show(`Uploading: ${files[0].name}${more} …`);
    label?.classList.add('pointer-events-none', 'opacity-50');
    input.form.submit();
  });
});

// Fullscreen view for images on the detail page.
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
  // A tap anywhere in fullscreen closes the view.
  viewer.addEventListener('click', () => viewer.close());
  viewer.addEventListener('close', () => {
    viewerImg.removeAttribute('src');
  });
}
