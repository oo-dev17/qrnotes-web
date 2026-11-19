// Warnt beim Verlassen eines Formulars mit ungespeicherten Änderungen:
// über den ←-Pfeil in der App und über den Zurück-Knopf des Browsers/Systems.
const WARNING = 'Ungespeicherte Änderungen verwerfen?';

const form = document.querySelector<HTMLFormElement>('form[data-note-form]');

if (form) {
  const fieldValues = (): string =>
    JSON.stringify(
      Array.from(form.elements).map((el) =>
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : '',
      ),
    );

  const initial = fieldValues();
  let guarded = false; // zusätzlicher History-Eintrag, damit Zurück abgefangen werden kann
  let ignorePop = false; // eigener history.forward()-Aufruf nach „Bleiben“
  let leaving = false; // gespeichert oder bestätigt: keine weitere Warnung mehr

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

  // ←-Pfeil in der Kopfzeile und „Scannen“ neben dem QR-Feld
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

  // Zurück-Knopf (Browser/System). Nach dem Guard-Eintrag liegt die Seite selbst einen Schritt zurück.
  window.addEventListener('popstate', () => {
    if (ignorePop) {
      ignorePop = false;
      return;
    }
    if (!guarded) return;
    guarded = false;
    if (isDirty()) {
      if (!window.confirm(WARNING)) {
        // Bleiben: zurück auf den Guard-Eintrag, damit die Warnung beim nächsten Zurück erneut kommt.
        ignorePop = true;
        window.history.forward();
        guarded = true;
        return;
      }
      leaving = true;
    }
    // Verlassen: den Eintrag davor ansteuern.
    window.history.back();
  });

  // Beim Schließen des Tabs / Neuladen ebenfalls warnen.
  window.addEventListener('beforeunload', (event) => {
    if (isDirty()) {
      event.preventDefault();
    }
  });
}
