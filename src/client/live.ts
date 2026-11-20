// Polls the server every 30 s (only while the tab is visible) for changes and then shows the banner.
// ready=false means the server does not know the state yet, so nothing is reported.
const POLL_MS = 30_000;

export function startLivePoll(
  url: string,
  isChanged: (data: { ready: boolean } & Record<string, unknown>) => boolean,
): void {
  const banner = document.getElementById('live-banner');
  const reload = document.getElementById('live-reload');
  if (!banner) return;

  reload?.addEventListener('click', () => window.location.reload());

  const check = async (): Promise<void> => {
    if (document.visibilityState !== 'visible' || !banner.hidden) return;
    try {
      const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
      if (res.status === 401) {
        window.location.assign('/login');
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { ready: boolean } & Record<string, unknown>;
      if (data.ready && isChanged(data)) banner.hidden = false;
    } catch {
      // Ignore network errors; the next attempt happens automatically.
    }
  };

  window.setInterval(check, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
}
