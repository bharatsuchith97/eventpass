/**
 * Progressive enhancement for the static landing page. The page is complete without this script
 * (that is what search engines index); it only adds the mobile menu toggle and a signed-in shortcut.
 */
const toggle = document.querySelector<HTMLButtonElement>('.menu-toggle');
const nav = document.getElementById('site-nav');
if (toggle && nav) {
  const setOpen = (open: boolean) => {
    nav.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
  nav.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('a')) setOpen(false);
  });
}

for (const el of document.querySelectorAll('[data-year]')) el.textContent = String(new Date().getFullYear());

// Already signed in? Offer a direct way back into the app instead of "Request access".
void (async () => {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin', headers: { 'X-Requested-With': 'eventpass' } });
    if (!res.ok) return;
    const { user } = (await res.json()) as { user: { role: string } };
    const cta = document.querySelector<HTMLAnchorElement>('[data-session="cta"]');
    if (cta) {
      cta.href = user.role === 'CHECKIN_STAFF' ? '/checkin' : '/dashboard';
      cta.textContent = 'Open EventPass';
    }
    document.querySelector('[data-session="signin"]')?.remove();
  } catch {
    /* offline or API down: keep the default links */
  }
})();
