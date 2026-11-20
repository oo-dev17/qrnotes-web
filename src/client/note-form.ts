// Warns when leaving a form with unsaved changes:
// via the ← arrow in the app and via the browser/system back button.
const WARNING = 'Discard unsaved changes?';

const form = document.querySelector<HTMLFormElement>('form[data-note-form]');

if (form) {
  const fieldValues = (): string =>
    JSON.stringify(
      Array.from(form.elements).map((el) =>
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : '',
      ),
    );

  const initial = fieldValues();
  let guarded = false; // extra history entry so that Back can be intercepted
  let ignorePop = false; // own history.forward() call after 'Stay'
  let leaving = false; // saved or confirmed: no further warning

  const isDirty = (): boolean => !leaving && fieldValues() !== initial;

  form.addEventListener('input', () => {
    if (isDirty() && !guarded) {
      window.history.pushState({ noteFormGuard: true }, '');
      guarded = true;
    }
  });

  form.addEventListener('submit', () => {
    leaving = true;
  });

  // ← arrow in the header and 'Scan' next to the QR field
  document.querySelectorAll<HTMLAnchorElement>('a[data-back]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (!isDirty()) return;
      if (window.confirm(WARNING)) {
        leaving = true;
      } else {
        event.preventDefault();
      }
    });
  });

  // Back button (browser/system). After the guard entry, the page itself is one step back.
  window.addEventListener('popstate', () => {
    if (ignorePop) {
      ignorePop = false;
      return;
    }
    if (!guarded) return;
    guarded = false;
    if (isDirty()) {
      if (!window.confirm(WARNING)) {
        // Stay: go back to the guard entry so the warning shows again on the next Back.
        ignorePop = true;
        window.history.forward();
        guarded = true;
        return;
      }
      leaving = true;
    }
    // Leave: navigate to the entry before.
    window.history.back();
  });

  // Also warn when closing the tab / reloading.
  window.addEventListener('beforeunload', (event) => {
    if (isDirty()) {
      event.preventDefault();
    }
  });
}
