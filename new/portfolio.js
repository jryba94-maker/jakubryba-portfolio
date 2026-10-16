(() => {
  'use strict';
  if (window.__jrPortfolioInitialized) return;
  window.__jrPortfolioInitialized = true;
  const $ = (selector) => document.querySelector(selector);
  const header = $('.site-header');
  const menu = $('.menu-toggle');
  const navigation = $('.navlinks');
  function closeMenu(restoreFocus = false) {
    navigation.classList.remove('open');
    menu.setAttribute('aria-expanded', 'false');
    menu.textContent = 'Menu +';
    if (restoreFocus) menu.focus();
  }
  menu.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    navigation.classList.toggle('open', open);
    menu.setAttribute('aria-expanded', String(open));
    menu.textContent = open ? 'Zamknij −' : 'Menu +';
  });
  navigation.addEventListener('click', (event) => {
    if (event.target.closest('a')) closeMenu();
  });
  document.addEventListener('click', (event) => {
    if (!header.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') closeMenu(true);
  });
  function updateHeader() { header.classList.toggle('is-scrolled', window.scrollY > 35); }
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });
  function revealLinkedProject() {
    const id = location.hash.slice(1);
    if (!id) return;
    const item = document.getElementById(id);
    if (item?.matches('details.case, details.product-dossier')) item.open = true;
  }
  window.addEventListener('hashchange', revealLinkedProject);
  revealLinkedProject();

  const viewport = $('.gallery-viewport');
  const track = $('.gallery-track');
  const group = $('.gallery-group');
  const duplicate = group.cloneNode(true);
  duplicate.setAttribute('aria-hidden', 'true');
  duplicate.inert = true;
  duplicate.querySelectorAll('button').forEach((button) => { button.tabIndex = -1; });
  track.append(duplicate);
  const pauseButton = $('.gallery-pause');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let userPaused = false;
  function updateGallery() {
    track.classList.toggle('is-user-paused', userPaused || reducedMotion.matches);
    pauseButton.hidden = reducedMotion.matches;
    pauseButton.setAttribute('aria-pressed', String(userPaused));
    pauseButton.textContent = userPaused ? 'Wznów przewijanie' : 'Zatrzymaj przewijanie';
    viewport.style.overflowX = reducedMotion.matches ? 'auto' : '';
    duplicate.hidden = reducedMotion.matches;
  }
  pauseButton.addEventListener('click', () => { userPaused = !userPaused; updateGallery(); });
  reducedMotion.addEventListener('change', updateGallery);
  updateGallery();
  const dialog = $('#photo-dialog');
  let photoTrigger = null;
  let priorOverflow = '';
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-photo]');
    if (!button || button.closest('[aria-hidden="true"]')) return;
    photoTrigger = button;
    const image = dialog.querySelector('img');
    image.src = button.dataset.photo;
    image.alt = button.querySelector('img')?.alt || 'Zdjęcie realizacji';
    priorOverflow = document.body.style.overflow;
    dialog.showModal();
    track.classList.add('paused');
    document.body.style.overflow = 'hidden';
  });
  dialog.querySelector('.photo-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    document.body.style.overflow = priorOverflow;
    track.classList.remove('paused');
    photoTrigger?.focus({ preventScroll: true });
  });

  // Storage is optional: interaction and analytics continue when it is blocked.
  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch {} }
  };
  const makeId = () => window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
  if (storage.get('jr_portfolio_owner') === '1' || navigator.webdriver) return;
  const pageId = makeId();
  const visitorKey = 'jr_portfolio_visitor';
  const visitKey = 'jr_portfolio_visit_v2';
  const visitorId = storage.get(visitorKey) || storage.get('jr_portfolio_session') || makeId();
  storage.set(visitorKey, visitorId);
  let sessionId = null;
  let inMemoryVisit = null;
  let maxScroll = 0;
  let activeSeconds = 0;
  let lastActive = Date.now();
  let lastTick = Date.now();
  let lastSent = 0;
  const engagement = new Map();
  function refreshVisit() {
    let visit;
    try { visit = JSON.parse(storage.get(visitKey)); } catch {}
    visit ||= inMemoryVisit;
    if (!visit || typeof visit.id !== 'string' || !Number.isFinite(visit.lastSeen) || Date.now() - visit.lastSeen >= 30 * 60 * 1000) visit = { id: makeId(), lastSeen: Date.now() };
    if (sessionId && sessionId !== visit.id) { maxScroll = 0; activeSeconds = 0; lastSent = 0; }
    sessionId = visit.id;
    visit.lastSeen = Date.now();
    inMemoryVisit = visit;
    storage.set(visitKey, JSON.stringify(visit));
  }
  function send(event, extra = {}) {
    refreshVisit();
    updateScroll();
    const body = JSON.stringify({ eventId: makeId(), pageId, event, sessionId, visitorId, pathname: location.pathname, scrollDepth: maxScroll, activeSeconds: Math.floor(activeSeconds), referrer: document.referrer, ...extra });
    try { window.fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {}); } catch {}
  }
  function updateScroll() {
    const distance = document.documentElement.scrollHeight - window.innerHeight;
    if (distance > 0) maxScroll = Math.max(maxScroll, Math.round(window.scrollY / distance * 100));
  }
  const projects = document.querySelectorAll('details.case, details.product-dossier');
  projects.forEach((item) => {
    const title = item.dataset.projectTitle || item.querySelector('h3')?.textContent.trim() || 'Projekt';
    const project = `${item.dataset.projectId || 'project'} — ${title}`.slice(0, 140);
    const state = { seconds: 0, sent: false, project };
    engagement.set(item, state);
    item.addEventListener('toggle', () => {
      state.seconds = 0;
      state.sent = false;
      if (item.open) send('project_expand', { target: 'project', project });
    });
  });
  function tick() {
    const now = Date.now();
    const elapsed = Math.min(2, Math.max(0, (now - lastTick) / 1000));
    lastTick = now;
    if (document.hidden || now - lastActive >= 30000) return;
    activeSeconds += elapsed;
    if (activeSeconds - lastSent >= 20) { lastSent = activeSeconds; send('engagement'); }
    engagement.forEach((state, item) => {
      if (!item.open || state.sent) return;
      const content = item.querySelector('.case-detail, .dossier-body') || item;
      const rect = content.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.height <= 0) return;
      state.seconds += elapsed;
      if (state.seconds >= 7) {
        state.sent = true;
        // Historical event name; this measures visible engaged opening, not reading.
        send('project_read', { target: 'project', project: state.project });
      }
    });
  }
  updateScroll();
  send('page_view');
  window.addEventListener('scroll', updateScroll, { passive: true });
  ['pointerdown', 'keydown', 'touchstart', 'pointermove', 'scroll'].forEach((name) => window.addEventListener(name, () => { lastActive = Date.now(); }, { passive: true }));
  document.addEventListener('visibilitychange', () => {
    lastTick = Date.now();
    if (document.hidden) send('engagement');
    else lastActive = Date.now();
  });
  window.addEventListener('pagehide', () => send('engagement'));
  window.setInterval(tick, 1000);
  document.querySelectorAll('[data-track]').forEach((link) => link.addEventListener('click', () => {
    const target = link.dataset.track;
    send(target === 'cv' ? 'cv_download' : 'outbound_click', { target });
  }));
})();
