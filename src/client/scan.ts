// QR- und Barcode-Scanner über die Kamera. Nur Chrome/Android (BarcodeDetector), HTTPS nötig.
type Detection = { rawValue: string };
type Detector = { detect(source: CanvasImageSource): Promise<Detection[]> };
type DetectorCtor = new (options: { formats: string[] }) => Detector;

const FORMATS = ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'];
const SCAN_INTERVAL_MS = 250;

const video = document.getElementById('scan-video') as HTMLVideoElement;
const statusEl = document.getElementById('scan-status') as HTMLParagraphElement;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

async function start(): Promise<void> {
  if (!window.isSecureContext) {
    setStatus('Die Kamera braucht HTTPS. Bitte die App über die HTTPS-Adresse öffnen.');
    return;
  }
  const Detector = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (!Detector || !navigator.mediaDevices?.getUserMedia) {
    setStatus('Dieser Browser kann keine Codes lesen. Bitte Chrome auf Android verwenden.');
    return;
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  } catch {
    setStatus('Kamera nicht verfügbar. Bitte die Kamera-Berechtigung prüfen.');
    return;
  }

  video.srcObject = stream;
  await video.play();
  const detector = new Detector({ formats: FORMATS });
  setStatus('Code vor die Kamera halten …');

  let busy = false;
  const timer = window.setInterval(async () => {
    if (busy || video.readyState < 2) return;
    busy = true;
    try {
      const codes = await detector.detect(video);
      const value = codes[0]?.rawValue;
      if (value) {
        window.clearInterval(timer);
        stream.getTracks().forEach((track) => track.stop());
        setStatus('Code erkannt …');
        const returnTo = document.querySelector<HTMLElement>('[data-return]')?.dataset.return ?? '';
        const params = new URLSearchParams({ code: value });
        if (returnTo) params.set('return', returnTo);
        window.location.assign(`/scan/result?${params.toString()}`);
      }
    } catch (err) {
      console.error('Scan fehlgeschlagen:', err);
    } finally {
      busy = false;
    }
  }, SCAN_INTERVAL_MS);
}

void start();
