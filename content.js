// AI Chat Bulk Delete: multi-select and one-click delete for the chat history in
// Google Search AI Mode, the Gemini app, Claude and ChatGPT. It drives each site's own UI
// (⋮ menu -> Delete -> confirm), so nothing private is called.
(() => {
  'use strict';
  if (window.__gbdLoaded) return;
  window.__gbdLoaded = true;

  const LOG = '[AI Chat Bulk Delete]';
  const DELETE_WORDS = ['delete', 'slet', 'löschen', 'supprimer', 'eliminar', 'elimina', 'excluir', 'verwijderen',
    'ta bort', 'radera', 'slett', 'poista', 'usuń', 'smazat', 'törlés', 'sil', 'удалить', 'видалити',
    '删除', '刪除', '削除', '삭제'];
  const DELETE_ICONS = ['delete', 'delete_outline', 'delete_forever'];
  const MORE_ICONS = ['more_vert', 'more_horiz'];
  const MORE_LABEL = /more|option|action|menu|flere|mulighed|handling|mehr|weitere|plus|más|opcion|altre|meer|fler|lisää|więcej/i;
  const SHOW_MORE = /\b(show more|see more|load more|vis flere|vis mere|mehr anzeigen|afficher plus|mostrar más|mostra altro)\b/i;
  const BUTTONISH = 'button, a[href], [role="button"], [role="menuitem"], [role="option"], [data-value]';
  const DIALOGS = 'mat-dialog-container, [role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"]';
  const CURRENT = '[aria-current="page"], [aria-current="true"], [aria-selected="true"]';
  const GAP_MS = 250;
  const POS_KEY = 'gbd-bar-pos';

  // ---------- helpers ----------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  // 2 = the label is exactly a delete word, 1 = it starts or ends with one.
  function deleteScore(text) {
    const t = norm(text);
    if (DELETE_WORDS.includes(t)) return 2;
    return DELETE_WORDS.some((w) => t.startsWith(w + ' ') || t.endsWith(' ' + w)) ? 1 : 0;
  }

  function isVisible(el) {
    if (!el || !el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function hasIcon(el, names) {
    return [...el.querySelectorAll('mat-icon, .material-icons, .material-symbols-outlined, .google-symbols')].some((i) =>
      names.includes((i.getAttribute('fonticon') || i.getAttribute('data-mat-icon-name') || i.textContent || '').trim()));
  }

  // Custom elements like <gem-button> wrap the real <button>.
  const clickable = (el) =>
    el.matches('button, a, [role="menuitem"], [role="button"]') ? el : el.querySelector('button, [role="button"]') || el;

  const titleOf = (el) => (el.innerText || el.textContent || '').split('\n').map((s) => s.trim()).find(Boolean) || '';

  async function waitFor(fn, timeout, interval = 100) {
    const end = Date.now() + timeout;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(interval);
    }
  }

  function pointAt(el) {
    const r = el.getBoundingClientRect();
    return { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
  }

  // Sends hover events down the whole path to the element under the row's centre,
  // so both mouseenter listeners (Gemini) and delegated mouseover handlers (Google Search) fire.
  function hover(row) {
    const o = pointAt(row);
    let deep = document.elementFromPoint(o.clientX, o.clientY);
    if (!deep || !row.contains(deep)) deep = row;
    const path = [];
    for (let n = deep; n && n !== row.parentElement; n = n.parentElement) path.unshift(n);
    for (const el of path) {
      el.dispatchEvent(new PointerEvent('pointerenter', { ...o, bubbles: false, pointerType: 'mouse' }));
      el.dispatchEvent(new MouseEvent('mouseenter', { ...o, bubbles: false }));
    }
    deep.dispatchEvent(new PointerEvent('pointerover', { ...o, pointerType: 'mouse' }));
    deep.dispatchEvent(new MouseEvent('mouseover', o));
    deep.dispatchEvent(new PointerEvent('pointermove', { ...o, pointerType: 'mouse' }));
    deep.dispatchEvent(new MouseEvent('mousemove', o));
  }

  // A full press as a real mouse sends it, for widgets that track pointerdown/up pairs.
  function click(el) {
    const o = { ...pointAt(el), view: window, button: 0, detail: 1 };
    const p = { ...o, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...p, buttons: 1 }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...o, buttons: 1 }));
    el.focus?.({ preventScroll: true });
    el.dispatchEvent(new PointerEvent('pointerup', p));
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.dispatchEvent(new MouseEvent('click', o));
  }

  function pressEnter(el) {
    el.focus?.({ preventScroll: true });
    const k = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
    el.dispatchEvent(new KeyboardEvent('keydown', k));
    el.dispatchEvent(new KeyboardEvent('keyup', k));
  }

  // Hover-only controls can be display:none until the real mouse is over the row, and some
  // menus won't open from an invisible anchor. Force el and its ancestors visible until undone.
  function reveal(el, stopAt) {
    const undo = [];
    for (let n = el; n && n !== stopAt; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const fix = {};
      if (cs.display === 'none') fix.display = 'block';
      if (cs.visibility === 'hidden') fix.visibility = 'visible';
      if (cs.opacity === '0') fix.opacity = '1';
      if (cs.pointerEvents === 'none') fix.pointerEvents = 'auto';
      if (!Object.keys(fix).length) continue;
      undo.push([n, n.getAttribute('style')]);
      Object.assign(n.style, fix);
    }
    return () => undo.forEach(([n, s]) => (s === null ? n.removeAttribute('style') : n.setAttribute('style', s)));
  }

  // Every visible element on the page (open shadow roots included) labelled exactly "Delete".
  // Diffing this before and after a click finds a menu or dialog wherever the site renders it.
  function deleteLabelled() {
    const out = new Set();
    const visit = (root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        if (t.nodeValue.length < 40 && deleteScore(t.nodeValue) === 2 && t.parentElement) out.add(t.parentElement);
      }
      for (const el of root.querySelectorAll('[aria-label]')) if (deleteScore(el.getAttribute('aria-label')) === 2) out.add(el);
    };
    visit(document.body);
    for (const host of document.body.querySelectorAll('*')) if (host.shadowRoot) visit(host.shadowRoot);
    return [...out].filter((el) => !el.closest('.gbd-ui, [data-thread-id], [data-gbd-row] a[href]') && isVisible(el));
  }

  // Collects elements the page adds from now on (outermost only), for failure reports.
  function watchAdded() {
    const added = new Set();
    const mo = new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) if (n instanceof Element && !n.closest('.gbd-ui')) added.add(n);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return {
      stop: () => mo.disconnect(),
      nodes: () => [...added].filter((n) => n.isConnected && ![...added].some((o) => o !== n && o.contains(n))),
    };
  }

  // ---------- generic finders shared by both sites ----------

  function genericMenuButton(row) {
    const own = (el) => el !== row && !el.closest('.gbd-ui');
    const triggers = [...row.querySelectorAll('[aria-haspopup], [aria-controls], [aria-expanded]')].filter(own);
    const trigger = triggers.find((el) => el.matches('[aria-haspopup]:not([aria-haspopup="false"])'))
      || triggers.find((el) => el.matches('[aria-controls]'))
      || triggers[0];
    if (trigger) return clickable(trigger);
    return [...row.querySelectorAll('button, [role="button"]')].find((b) =>
      own(b) && (hasIcon(b, MORE_ICONS) || MORE_LABEL.test(b.getAttribute('aria-label') || ''))) || null;
  }

  function popupOf(trigger) {
    const id = trigger?.getAttribute('aria-controls');
    const popup = id && document.getElementById(id);
    return popup && isVisible(popup) ? popup : null;
  }

  const openMenus = () => [...document.querySelectorAll('[role="menu"], [role="listbox"], .cdk-overlay-container')].filter(isVisible);

  // Picks the most delete-like visible control inside the given containers.
  function bestDeleteControl(scopes, minScore, skipRows = false) {
    let best = null, bestScore = 0;
    for (const scope of scopes) {
      for (const el of scope.querySelectorAll(BUTTONISH)) {
        if (el.closest('.gbd-ui') || (skipRows && el.closest('[data-gbd-row]')) || !isVisible(el)) continue;
        let score = Math.max(deleteScore(el.innerText || el.textContent), deleteScore(el.getAttribute('aria-label')));
        if (/delet|remov|trash/i.test((el.getAttribute('data-value') || '') + (el.getAttribute('data-test-id') || ''))) score = 3;
        else if (hasIcon(el, DELETE_ICONS)) score = Math.max(score, 2);
        if (score > bestScore) { best = el; bestScore = score; }
      }
    }
    return bestScore >= minScore ? clickable(best) : null;
  }

  function dialogConfirmButton(confirmSelector) {
    for (const d of document.querySelectorAll(DIALOGS)) {
      if (!isVisible(d)) continue;
      const tagged = confirmSelector && d.querySelector(confirmSelector);
      const btn = tagged ? clickable(tagged) : bestDeleteControl([d], 1);
      if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') return btn;
    }
    return null;
  }

  // ---------- site: Gemini (gemini.google.com) ----------

  const GEMINI = {
    conversation: '[data-test-id="conversation"]',
    conversationLink: 'a[href*="/app/"], a[href*="/gem/"]',
    sidebar: 'side-navigation, bard-sidenav, mat-sidenav, nav, [role="navigation"]',
    listBoundary: '[role="list"], mat-nav-list, mat-action-list, mat-list, conversations-list, side-navigation, bard-sidenav, mat-sidenav, nav, [role="navigation"]',
    menuButton: '[data-test-id="actions-menu-button"]',
    deleteItem: '.cdk-overlay-container [data-test-id="delete-button"], [role="menu"] [data-test-id="delete-button"]',
    confirmButton: '[data-test-id="confirm-button"]',
  };
  const CONVO_PATH = /^(?:\/u\/\d+)?\/(?:app\/[\w-]{6,}|gem\/[^/]+\/[\w-]{6,})/;
  const rowCache = new WeakMap();
  let uid = 0;

  // The row is the per-chat wrapper that holds both the title and its ⋮ button: the highest
  // ancestor that still contains only this one chat and isn't much taller than it.
  function rowFor(convo, countSel, boundary) {
    const cached = rowCache.get(convo);
    if (cached && cached.contains(convo)) return cached;
    const height = convo.getBoundingClientRect().height;
    let row = convo;
    for (let i = 0; i < 3; i++) {
      const p = row.parentElement;
      if (!p || p === document.body || p.matches(boundary)) break;
      if (p.querySelectorAll(countSel).length > 1) break;
      if (height && p.getBoundingClientRect().height > height * 1.6) break;
      row = p;
    }
    rowCache.set(convo, row);
    return row;
  }

  function geminiKey(convo) {
    const a = convo.closest('a[href]') || convo.querySelector('a[href]');
    if (a && CONVO_PATH.test(a.pathname)) return a.pathname.replace(/^\/u\/\d+/, '');
    const m = (convo.getAttribute('jslog') || '').match(/\bc_[0-9a-f]{8,}\b/);
    if (m) return m[0];
    return convo.dataset.gbdUid || (convo.dataset.gbdUid = 'el-' + ++uid);
  }

  const gemini = {
    name: 'Gemini',
    statsKey: 'gemini',
    isActive: () => true,
    findChats() {
      let convos = [...document.querySelectorAll(GEMINI.conversation)];
      let countSel = GEMINI.conversation;
      if (!convos.length) {
        convos = [...document.querySelectorAll('a[href]')].filter((a) => CONVO_PATH.test(a.pathname) && a.closest(GEMINI.sidebar));
        countSel = GEMINI.conversationLink;
      }
      const seen = new Set();
      const out = [];
      for (const convo of convos) {
        if (convo.closest('.gbd-ui') || convo.parentElement?.closest(GEMINI.conversation)) continue;
        const key = geminiKey(convo);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ key, row: rowFor(convo, countSel, GEMINI.listBoundary), title: titleOf(convo), stable: true });
      }
      return out;
    },
    findMenuButton(row) {
      const tagged = row.querySelector(GEMINI.menuButton);
      return tagged ? clickable(tagged) : genericMenuButton(row);
    },
    findDeleteItem() {
      const tagged = [...document.querySelectorAll(GEMINI.deleteItem)].map(clickable).find(isVisible);
      return tagged || bestDeleteControl(openMenus(), 1);
    },
    findConfirmButton: () => dialogConfirmButton(GEMINI.confirmButton),
    isCurrent: (item) => location.pathname.replace(/^\/u\/\d+/, '') === item.key,
    debugRoot: () => document.querySelector('side-navigation, bard-sidenav, mat-sidenav') || document.querySelector(GEMINI.sidebar),
  };

  // ---------- site: Google Search AI Mode (google.com/search?udm=50) ----------

  // Class names on Google Search are obfuscated, so only ids, data-* and ARIA hooks are used.
  // If the thread list itself can't be found, rows are found by shape instead: the element
  // inside the threads panel with the most full-width, text-bearing children.
  const AIM = {
    threadsRoot: '#aim-lhs-panel-threads-view-container, [data-xid="aim-threads-view"]',
    rows: '[data-xid="threads-list-root"] > [role="listitem"]',
    threadId: '[data-thread-id]',
    menuButton: '[id^="actions-button-"] button',
  };
  let aimList = null;

  function aimChatsByShape() {
    const root = aimRoot();
    const width = root ? root.getBoundingClientRect().width : 0;
    if (!width) return [];
    const isRow = (el) => {
      if (el.matches('.gbd-ui, [role="heading"], h1, h2, h3, h4, h5, h6') || el.querySelector('[role="heading"], h1, h2, h3, h4, h5, h6')) return false;
      const r = el.getBoundingClientRect();
      return r.height >= 24 && r.height <= 80 && r.width >= width * 0.6 && titleOf(el) !== '';
    };
    if (!aimList || !root.contains(aimList) || ![...aimList.children].some(isRow)) {
      aimList = null;
      let best = 0;
      for (const el of root.querySelectorAll('*')) {
        if (!el.childElementCount || el.closest('.gbd-ui')) continue;
        let n = 0;
        for (const c of el.children) if (isRow(c)) n++;
        if (n > best) { aimList = el; best = n; }
      }
    }
    if (!aimList) return [];
    // Titles aren't unique, so the key is the title plus how many times it appeared above.
    const seen = new Map();
    return [...aimList.children].filter(isRow).map((row) => {
      const title = titleOf(row);
      const n = seen.get(title) || 0;
      seen.set(title, n + 1);
      return { key: `${title}\u0001${n}`, row, title, stable: false };
    });
  }

  function aimRoot() {
    const root = document.querySelector(AIM.threadsRoot);
    if (root) return root;
    return [...document.querySelectorAll('[role="navigation"]')].find((n) => {
      const r = n.getBoundingClientRect();
      return r.width > 150 && r.width < 450 && r.left < 50;
    }) || null;
  }

  const aiMode = {
    name: 'AI Mode',
    statsKey: 'aiMode',
    isActive: () => !!document.querySelector(AIM.threadsRoot) || new URLSearchParams(location.search).get('udm') === '50',
    findChats() {
      const rows = [...document.querySelectorAll(AIM.rows)].filter((r) => r.querySelector(AIM.threadId));
      if (!rows.length) return aimChatsByShape();
      return rows.map((row) => {
        const thread = row.querySelector(AIM.threadId);
        return { key: 'thread:' + thread.dataset.threadId, row, title: titleOf(thread) || titleOf(row), stable: true };
      });
    },
    findMenuButton(row) {
      const tagged = row.querySelector(AIM.menuButton);
      return tagged ? clickable(tagged) : genericMenuButton(row);
    },
    findDeleteItem(trigger) {
      const popup = popupOf(trigger);
      if (popup) return bestDeleteControl([popup], 1);
      const menus = openMenus();
      return (menus.length && bestDeleteControl(menus, 1))
        || bestDeleteControl([...document.querySelectorAll('[role="list"]')].filter(isVisible), 2, true);
    },
    findConfirmButton: () => dialogConfirmButton(null),
    isCurrent: () => false,
    debugRoot: aimRoot,
  };

  // ---------- site: Claude (claude.ai) ----------

  // claude.ai's sidebar and chat list are built from accessible components (menu buttons with
  // aria-haspopup, role="menu" and role="dialog"), so the generic finders do the work.
  const CLAUDE = {
    knownItem: 'a[href*="/chat/"], a[href*="/cowork/"], a[href*="/task/"]',
    link: 'a[href^="/"]',
    listBoundary: 'ul, ol, [role="list"], nav, [role="navigation"], aside, main',
  };
  // Chats are /chat/<uuid>; tasks (Cowork, Claude in Chrome) are /cowork/<id>, e.g. /cowork/cse_01LJ….
  const CLAUDE_ITEM = /^\/(?:chat|cowork|task)\/[\w-]{8,}\/?$/;
  // A link shaped like /<kind>/<id> that sits in the same list as known chats and tasks is treated
  // as one too, so a new kind of task still shows up. These kinds are never chats.
  const CLAUDE_LIKE = /^\/[a-z-]+\/[\w-]*\d[\w-]*\/?$/;
  const CLAUDE_NOT_ITEM = /^\/(?:projects?|artifacts?|settings|customize|new|recents|admin|org|upgrade|login|logout)\//;
  const claudeKey = (path) => 'claude:' + path.replace(/\/$/, '');

  const claude = {
    name: 'Claude',
    statsKey: 'claude',
    isActive: () => true,
    findChats() {
      const isOurs = (a) => a.closest('.gbd-ui');
      const lists = new Set();
      for (const a of document.querySelectorAll(CLAUDE.knownItem)) {
        const list = CLAUDE_ITEM.test(a.pathname) && !isOurs(a) && a.closest(CLAUDE.listBoundary);
        if (list) lists.add(list);
      }
      const seen = new Set();
      const out = [];
      for (const a of document.querySelectorAll(CLAUDE.link)) {
        const p = a.pathname;
        const item = CLAUDE_ITEM.test(p)
          || (CLAUDE_LIKE.test(p) && !CLAUDE_NOT_ITEM.test(p) && lists.has(a.closest(CLAUDE.listBoundary)));
        if (!item || isOurs(a)) continue;
        // A chat shown twice (sidebar and a chat list on the page) is handled once, at its first spot.
        const key = claudeKey(p);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ key, row: rowFor(a, CLAUDE.link, CLAUDE.listBoundary), title: titleOf(a), stable: true });
      }
      return out;
    },
    findMenuButton: genericMenuButton,
    findDeleteItem(trigger) {
      const popup = popupOf(trigger);
      return popup ? bestDeleteControl([popup], 1) : bestDeleteControl(openMenus(), 1);
    },
    findConfirmButton: () => dialogConfirmButton(null),
    isCurrent: (item) => claudeKey(location.pathname) === item.key,
    debugRoot: () => document.querySelector(CLAUDE.knownItem)?.closest('nav, [role="navigation"], aside') || document.querySelector('nav'),
  };

  // ---------- site: ChatGPT (chatgpt.com) ----------

  // ChatGPT tags its sidebar controls with data-testid; the generic finders are the fallback.
  const CHATGPT = {
    chatLink: 'nav a[href*="/c/"]',
    anyChatLink: 'a[href*="/c/"]',
    listBoundary: 'nav, aside, ol, ul, [role="list"], #history',
    menuButton: '[data-testid$="-options"], [data-trailing-button]',
    deleteItem: '[data-testid="delete-chat-menu-item"]',
    confirmButton: '[data-testid="delete-conversation-confirm-button"]',
  };
  // Plain chats are /c/<id>; chats inside a project or GPT are /g/<project>/c/<id>.
  const GPT_PATH = /^(?:\/g\/[^/]+)?\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

  const chatgpt = {
    name: 'ChatGPT',
    statsKey: 'chatgpt',
    isActive: () => true,
    findChats() {
      let links = document.querySelectorAll(CHATGPT.chatLink);
      if (!links.length) links = document.querySelectorAll(CHATGPT.anyChatLink);
      const seen = new Set();
      const out = [];
      for (const a of links) {
        const m = a.pathname.match(GPT_PATH);
        if (!m || a.closest('.gbd-ui')) continue;
        const key = 'gpt:' + m[1].toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ key, row: rowFor(a, CHATGPT.anyChatLink, CHATGPT.listBoundary), title: titleOf(a), stable: true });
      }
      return out;
    },
    findMenuButton(row) {
      const tagged = row.querySelector(CHATGPT.menuButton);
      return tagged ? clickable(tagged) : genericMenuButton(row);
    },
    findDeleteItem(trigger) {
      const tagged = [...document.querySelectorAll(CHATGPT.deleteItem)].find(isVisible);
      if (tagged) return tagged;
      const popup = popupOf(trigger);
      return popup ? bestDeleteControl([popup], 1) : bestDeleteControl(openMenus(), 1);
    },
    findConfirmButton: () => dialogConfirmButton(CHATGPT.confirmButton),
    isCurrent: (item) => 'gpt:' + (location.pathname.match(GPT_PATH)?.[1] || '').toLowerCase() === item.key,
    debugRoot: () => document.querySelector('#history') || document.querySelector(CHATGPT.chatLink)?.closest('nav') || document.querySelector('nav'),
  };

  const site = location.hostname === 'gemini.google.com' ? gemini
    : location.hostname === 'claude.ai' ? claude
    : /(^|\.)chatgpt\.com$|^chat\.openai\.com$/.test(location.hostname) ? chatgpt
    : aiMode;

  // ---------- state ----------

  const html = document.documentElement;
  const selected = new Set();
  const pending = new Set();
  const failed = new Set();
  const queue = []; // { key, row, title, countBefore? }
  let items = [];
  let mode = 'idle'; // 'idle' | 'select'
  let running = false;
  let loading = false;
  let stopRequested = false;
  let progress = { done: 0, total: 0 };
  let lastKey = null;
  let armed = false;
  let armTimer = 0;
  let flashText = '';
  let flashTimer = 0;
  let lastFailure = '';

  // ---------- deleting ----------

  function resolve(entry) {
    const list = site.findChats();
    return list.find((i) => i.row === entry.row && i.title === entry.title) || list.find((i) => i.key === entry.key) || null;
  }

  function isGone(entry) {
    const list = site.findChats();
    if (list.some((i) => i.row === entry.row)) return false;
    if (entry.stable) return !list.some((i) => i.key === entry.key);
    return list.filter((i) => i.title === entry.title).length < entry.countBefore;
  }

  // Snapshot of the page at a failed step, with chat titles masked, for the debug info.
  function failure(step, row, trigger, added) {
    const parts = [`step: ${step}`];
    if (trigger) parts.push(`⋮ button: ${describe(trigger)} visible=${isVisible(trigger)} expanded=${trigger.getAttribute('aria-expanded')}`);
    if (document.activeElement) parts.push(`focused: ${describe(document.activeElement)}`);
    if (row?.isConnected) parts.push('row: ' + sanitize(row, true));
    const popup = trigger && popupOf(trigger);
    if (popup) parts.push('popup: ' + sanitize(popup, false));
    const open = new Set([...document.querySelectorAll(`${DIALOGS}, [role="menu"], [role="listbox"]`)].filter(isVisible));
    try { document.querySelectorAll(':popover-open').forEach((p) => open.add(p)); } catch {}
    for (const d of open) if (d !== popup) parts.push('open: ' + sanitize(d, false, 6000));
    for (const n of (added?.nodes() || []).slice(0, 4)) {
      parts.push(`added after the click (visible=${isVisible(n)}): ` + sanitize(n, !!(n.closest('[data-gbd-row]') || n.querySelector('[data-gbd-row]')), 6000));
    }
    lastFailure = parts.join('\n\n');
    return new Error(`${step} failed`);
  }

  async function closeOverlays() {
    for (const d of document.querySelectorAll(DIALOGS)) {
      if (!isVisible(d)) continue;
      const cancel = d.querySelector('[data-test-id="cancel-button"]')
        || [...d.querySelectorAll('button, [role="button"]')].find((b) => /^(cancel|annuller|abbrechen|annuler|cancelar|annulla|annuleren|avbryt|peruuta|anuluj)$/i.test(norm(b.textContent)));
      if (cancel) click(clickable(cancel));
    }
    document.querySelectorAll('.cdk-overlay-backdrop').forEach((b) => click(b));
    const esc = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', esc));
    await sleep(300);
  }

  async function deleteSteps(entry) {
    const { row } = entry;
    row.scrollIntoView({ block: 'nearest' });
    await sleep(50);
    const menuBtn = await waitFor(() => { hover(row); return site.findMenuButton(row); }, 2500, 150);
    if (!menuBtn) throw failure('finding the ⋮ button', row);

    const unreveal = reveal(menuBtn, row);
    const added = watchAdded();
    let deleteItem, confirmBtn;
    try {
      const beforeMenu = new Set(deleteLabelled());
      const findDeleteItem = () => site.findDeleteItem(menuBtn) || deleteLabelled().find((el) => !beforeMenu.has(el));
      click(menuBtn);
      deleteItem = await waitFor(findDeleteItem, 1200);
      if (!deleteItem) {
        pressEnter(menuBtn);
        deleteItem = await waitFor(findDeleteItem, 1300);
      }
      if (!deleteItem) throw failure('finding "Delete" in the menu', row, menuBtn, added);

      const beforeConfirm = new Set(deleteLabelled());
      click(deleteItem);
      confirmBtn = await waitFor(() => site.findConfirmButton()
        || deleteLabelled().find((el) => !beforeConfirm.has(el) && el !== deleteItem)
        || (isGone(entry) && 'gone'), 4000);
      if (!confirmBtn) throw failure('finding the confirm button', row, menuBtn, added);
    } finally {
      added.stop();
      unreveal();
    }
    if (confirmBtn === 'gone') return;
    await sleep(120);
    click(confirmBtn);

    let lastClick = Date.now();
    const gone = await waitFor(() => {
      const again = site.findConfirmButton();
      if (again && Date.now() - lastClick > 1500) {
        click(again);
        lastClick = Date.now();
      }
      return !again && isGone(entry);
    }, 12000, 150);
    if (!gone) throw failure('waiting for the chat to disappear', row);
  }

  async function deleteOne(entry) {
    for (let attempt = 0; attempt < 2; attempt++) {
      // A retry that finds the chat gone means the first attempt went through after all.
      if (attempt && isGone(entry)) return 'deleted';
      const item = await waitFor(() => resolve(entry), attempt ? 1500 : 800);
      if (!item) return attempt ? 'deleted' : 'missing';
      entry.row = item.row;
      entry.countBefore = site.findChats().filter((i) => i.title === item.title).length;
      try {
        await deleteSteps(entry);
        return 'deleted';
      } catch (err) {
        console.warn(LOG, `"${item.title.slice(0, 60)}":`, err.message);
        await closeOverlays();
      }
    }
    return 'failed';
  }

  const entryOf = (item) => ({ key: item.key, row: item.row, title: item.title, stable: item.stable });

  // Lifetime count of deleted chats, shown in the extension's popup. Updates are chained so
  // back-to-back deletions in this tab don't overwrite each other.
  let statsWrite = Promise.resolve();
  function countDeletion() {
    const storage = globalThis.chrome?.storage?.local;
    if (!storage) return;
    const field = site.statsKey;
    statsWrite = statsWrite.then(async () => {
      const { stats = {} } = await storage.get('stats');
      await storage.set({ stats: { ...stats, total: (stats.total || 0) + 1, [field]: (stats[field] || 0) + 1 } });
    }).catch(() => {}); // the extension was reloaded under this tab; the count is lost, nothing else
  }

  function enqueue(entries) {
    for (const e of entries) {
      if (queue.some((q) => q.key === e.key)) continue;
      queue.push(e);
      pending.add(e.key);
      failed.delete(e.key);
    }
    scan();
    processQueue();
  }

  async function processQueue() {
    if (running) return;
    running = true;
    stopRequested = false;
    progress = { done: 0, total: queue.length };
    let deleted = 0, failedCount = 0, missing = 0;

    while (queue.length && !stopRequested) {
      progress.total = progress.done + queue.length;
      render();
      const entry = queue[0];
      const result = await deleteOne(entry);
      queue.shift();
      pending.delete(entry.key);
      progress.done++;
      if (result === 'failed') {
        failedCount++;
        failed.add(entry.key);
      } else {
        if (result === 'deleted') {
          deleted++;
          countDeletion();
        } else {
          missing++;
        }
        selected.delete(entry.key);
      }
      scan();
      if (queue.length && !stopRequested) await sleep(GAP_MS);
    }

    for (const e of queue) pending.delete(e.key);
    queue.length = 0;
    running = false;
    const parts = [`Deleted ${deleted} chat${deleted === 1 ? '' : 's'}`];
    if (failedCount) parts.push(`${failedCount} failed`);
    if (missing) parts.push(`${missing} not found`);
    if (stopRequested) parts.push('stopped');
    if (mode === 'select' && !selected.size) mode = 'idle';
    flash(parts.join(' · '), failedCount ? 8000 : 4000);
    scan();
  }

  function quickDelete(row) {
    const item = items.find((i) => i.row === row);
    if (item && mode !== 'select') enqueue([entryOf(item)]);
  }

  // ---------- loading the full list ----------

  function findScroller(el) {
    for (let n = el; n && n !== html; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && n.scrollHeight > n.clientHeight + 4) return n;
    }
    return null;
  }

  function clickShowMore(container) {
    if (!container) return;
    for (const b of container.querySelectorAll('button, [role="button"]')) {
      if (b.closest('.gbd-ui, [data-gbd-row]') || !isVisible(b)) continue;
      if (b.matches('[data-test-id*="show-more"]') || SHOW_MORE.test(b.textContent)) click(b);
    }
  }

  async function loadAll() {
    if (loading || running) return;
    loading = true;
    render();
    try {
      let last = -1, still = 0;
      while (loading && still < 3) {
        const tail = items[items.length - 1];
        if (!tail) break;
        clickShowMore(site.debugRoot());
        const scroller = findScroller(tail.row);
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
        tail.row.scrollIntoView({ block: 'end' });
        await sleep(800);
        scan();
        if (items.length === last) still++;
        else { still = 0; last = items.length; }
      }
    } finally {
      loading = false;
      scan();
    }
  }

  // ---------- selection ----------

  function toggle(key, range) {
    if (!key || running) return;
    const keys = items.map((i) => i.key);
    if (range && lastKey && lastKey !== key && keys.includes(lastKey) && keys.includes(key)) {
      const [a, b] = [keys.indexOf(lastKey), keys.indexOf(key)].sort((x, y) => x - y);
      const on = selected.has(lastKey);
      for (const k of keys.slice(a, b + 1)) on ? selected.add(k) : selected.delete(k);
    } else {
      selected.has(key) ? selected.delete(key) : selected.add(key);
    }
    lastKey = key;
    disarm();
    scan();
  }

  function enterSelect() {
    mode = 'select';
    flashText = '';
    scan();
  }

  function exitSelect() {
    mode = 'idle';
    selected.clear();
    lastKey = null;
    disarm();
    scan();
  }

  function selectAll() {
    for (const i of items) selected.add(i.key);
    disarm();
    scan();
  }

  function clearSelection() {
    selected.clear();
    disarm();
    scan();
  }

  function disarm() {
    armed = false;
    clearTimeout(armTimer);
  }

  function onDeleteClick() {
    if (!selected.size || running) return;
    if (!armed) {
      armed = true;
      clearTimeout(armTimer);
      armTimer = setTimeout(() => { armed = false; render(); }, 4000);
      render();
      return;
    }
    disarm();
    // Bottom-up keeps the title-based keys of the rows above stable, and the open
    // chat goes last in case deleting it navigates away.
    const chosen = items.filter((i) => selected.has(i.key)).reverse();
    const isCurrent = (i) => i.row.matches(CURRENT) || !!i.row.querySelector(CURRENT) || site.isCurrent(i);
    enqueue([...chosen.filter((i) => !isCurrent(i)), ...chosen.filter(isCurrent)].map(entryOf));
  }

  function stop() {
    stopRequested = true;
    loading = false;
    render();
  }

  function flash(text, ms = 4000) {
    flashText = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flashText = ''; render(); }, ms);
    render();
  }

  // ---------- debug info ----------

  const mask = (s) => s.replace(/\S/g, 'x');
  // Keeps the first three words (UI wording like "More options for"), masks the rest (chat titles).
  const maskTail = (s) => s.split(/(\s+)/).map((w, i) => (i < 6 ? w : mask(w))).join('');
  // Inside chat rows a label keeps its UI wording only when it reads like "More options for <title>".
  const maskLabel = (s) => (MORE_LABEL.test(s.split(/\s+/).slice(0, 2).join(' ')) ? maskTail(s) : mask(s));

  function describe(el) {
    const inRow = !!el.closest('[data-gbd-row]');
    const attrs = [...el.attributes]
      .filter((a) => /^(id|class|role|type|tabindex|popover|jsname|data-value|data-test-id|data-thread-id|aria-(?!label))/.test(a.name))
      .map((a) => `${a.name}="${a.value.slice(0, 60)}"`);
    const label = el.getAttribute('aria-label');
    if (label) attrs.push(`aria-label="${inRow ? maskLabel(label) : maskTail(label)}"`);
    const own = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.nodeValue).join('').trim();
    const shadow = el.getRootNode() instanceof ShadowRoot ? ' (inside shadow root)' : '';
    return `<${el.tagName.toLowerCase()} ${attrs.join(' ')}>${own ? (inRow ? mask(own) : maskTail(own)).slice(0, 40) : ''}${shadow}`;
  }

  // Page structure with chat titles and URLs masked, for fixing selectors when Google changes the page.
  function sanitize(el, maskText, limit = 12000) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.gbd-ui, script, style').forEach((n) => n.remove());
    clone.querySelectorAll('svg').forEach((n) => n.replaceChildren());
    [...clone.querySelectorAll('[data-gbd-row]')].slice(5).forEach((n) => n.remove());
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) t.nodeValue = maskText ? mask(t.nodeValue) : maskTail(t.nodeValue);
    for (const n of [clone, ...clone.querySelectorAll('*')]) {
      for (const { name, value } of [...n.attributes]) {
        if (/^(data-ved|ping|jslog|data-hveid|data-wiz-uids|data-sfc-|data-processed|data-complete)/.test(name)) n.removeAttribute(name);
        else if (name === 'href') n.setAttribute(name, value.replace(/=([^&#]*)/g, (_, v) => '=' + 'x'.repeat(Math.min(v.length, 6))));
        else if (name === 'data-gbd-key') n.setAttribute(name, mask(value));
        else if (/^(aria-label|title|alt)$/.test(name)) n.setAttribute(name, maskText ? maskLabel(value) : maskTail(value));
        else if (value.length > 160) n.setAttribute(name, value.slice(0, 160) + '…');
      }
    }
    const out = clone.outerHTML.replace(/<!--[\s\S]*?-->/g, '');
    return out.length > limit ? out.slice(0, limit) + ' …[truncated]' : out;
  }

  // The 🐞 button first starts recording: each real click is logged with what appeared on the
  // page right after it, so deleting one chat by hand captures the exact menu and dialog markup.
  // The second click on 🐞 stops and copies everything.
  let recording = null; // { steps: [] }
  const POPUPS = '[popover], [role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"], [role="list"], [aria-modal]';

  function recordClick(e) {
    if (!e.isTrusted || !recording) return;
    const path = e.composedPath().filter((n) => n instanceof Element);
    if (path.some((n) => n.classList.contains('gbd-ui'))) return;
    const step = { clicked: path.slice(0, 8).map(describe).join('\n    inside '), container: '', appeared: [] };
    const box = path.find((n) => n.matches(`${POPUPS}, [data-gbd-row]`));
    if (box) step.container = sanitize(box, box.matches('[data-gbd-row]') || !!box.querySelector('[data-gbd-row]'), 8000);
    recording.steps.push(step);
    const changed = new Set();
    const added = watchAdded();
    const mo = new MutationObserver((muts) => muts.forEach((m) => m.target.matches?.(POPUPS) && changed.add(m.target)));
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'open', 'aria-hidden'] });
    setTimeout(() => {
      added.stop();
      mo.disconnect();
      step.appeared = [...added.nodes(), ...changed].filter(isVisible).slice(0, 4)
        .map((n) => sanitize(n, !!(n.closest('[data-gbd-row]') || n.querySelector('[data-gbd-row]')), 6000));
      render();
    }, 800);
    render();
  }

  async function onDebugClick() {
    if (!recording) {
      if (mode === 'select') exitSelect();
      recording = { steps: [] };
      addEventListener('click', recordClick, true);
      render();
      return;
    }
    removeEventListener('click', recordClick, true);
    const steps = recording.steps;
    recording = null;
    await copyDebug(steps);
  }

  async function copyDebug(steps) {
    const first = items[0];
    if (first) hover(first.row);
    await sleep(300);
    const menuBtn = first && site.findMenuButton(first.row);
    const root = site.debugRoot();
    const text = [
      `AI Chat Bulk Delete ${globalThis.chrome?.runtime?.getManifest?.().version ?? '?'} on ${site.name}, ${navigator.userAgent}`,
      `chats found: ${items.length}`,
      `menu button of first chat: ${menuBtn ? sanitize(menuBtn, true, 1500) : 'not found'}`,
      steps.length
        ? 'recorded clicks:\n\n' + steps.map((s, i) => `#${i + 1} clicked: ${s.clicked}\n\n  container: ${s.container || '-'}\n\n  appeared after: ${s.appeared.join('\n\n  ') || '-'}`).join('\n\n')
        : 'no clicks recorded',
      lastFailure ? `last failure:\n${lastFailure}` : 'no failures recorded',
      `sidebar:\n${root ? sanitize(root, true, 30000) : 'not found'}`,
    ].join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      flash('Debug info copied (chat titles are masked)', 6000);
    } catch {
      console.log(LOG, text);
      flash('Could not copy. Debug info is in the console', 6000);
    }
  }

  // ---------- UI ----------

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    grip: 'M9 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM9 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-6 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
    bug: 'M20 8h-2.81a5.99 5.99 0 0 0-1.82-1.96L17 4.41 15.59 3l-2.17 2.17a6.02 6.02 0 0 0-2.83 0L8.41 3 7 4.41l1.62 1.63A5.99 5.99 0 0 0 6.81 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81a5.99 5.99 0 0 0 10.38 0H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20V8zm-6 8h-4v-2h4v2zm0-4h-4v-2h4v2z',
  };

  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    el.append(...kids);
    return el;
  }

  function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', ICONS[name]);
    svg.append(path);
    return svg;
  }

  const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
  const setFlag = (el, attr, on) => { if (el.hasAttribute(attr) !== on) el.toggleAttribute(attr, on); };

  const statusEl = h('span', { class: 'gbd-status', 'aria-live': 'polite' });
  const deleteLabel = h('span');
  const grip = h('span', { class: 'gbd-grip', title: 'Drag to move' }, icon('grip'));
  const launchBtn = h('button', { type: 'button', title: 'Select chats to delete', onclick: enterSelect }, icon('trash'), 'Bulk delete');
  const selectAllBtn = h('button', { type: 'button', title: 'Select every chat loaded in the sidebar', onclick: selectAll }, 'Select all');
  const loadAllBtn = h('button', { type: 'button', title: 'Scroll the sidebar until every chat is loaded', onclick: loadAll }, 'Load all');
  const clearBtn = h('button', { type: 'button', onclick: clearSelection }, 'Clear');
  const deleteBtn = h('button', { type: 'button', class: 'gbd-danger', onclick: onDeleteClick }, icon('trash'), deleteLabel);
  const stopBtn = h('button', { type: 'button', class: 'gbd-danger', onclick: stop }, 'Stop');
  const debugBtn = h('button', { type: 'button', class: 'gbd-icon-btn', title: 'Debug: record a manual delete, then click again to copy', 'aria-label': 'Debug info', onclick: onDebugClick }, icon('bug'));
  const closeBtn = h('button', { type: 'button', class: 'gbd-icon-btn', title: 'Done', 'aria-label': 'Exit selection', onclick: exitSelect }, icon('close'));
  const bar = h('div', { class: 'gbd-ui gbd-bar' },
    grip, launchBtn, statusEl, selectAllBtn, loadAllBtn, clearBtn, deleteBtn, stopBtn, debugBtn, closeBtn);

  function makeCheck() {
    return h('span', {
      class: 'gbd-ui gbd-check',
      role: 'checkbox',
      title: 'Select (Shift-click for a range)',
      onclick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(e.currentTarget.parentElement?.dataset.gbdKey, e.shiftKey);
      },
    });
  }

  function makeQuick() {
    const swallow = (e) => e.stopPropagation();
    return h('button', {
      type: 'button',
      class: 'gbd-ui gbd-quick',
      title: 'Delete this chat now (no confirmation)',
      'aria-label': 'Delete this chat',
      onpointerdown: swallow,
      onmousedown: swallow,
      onclick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        quickDelete(e.currentTarget.parentElement);
      },
    }, icon('trash'));
  }

  // Sit the trash button just left of the site's own ⋮ button.
  function positionQuick(e) {
    const row = e.currentTarget;
    requestAnimationFrame(() => {
      const quick = row.querySelector(':scope > .gbd-quick');
      if (!quick) return;
      const btn = site.findMenuButton(row);
      const br = btn && isVisible(btn) ? btn.getBoundingClientRect() : null;
      quick.style.right = br && br.width ? Math.max(4, row.getBoundingClientRect().right - br.left + 4) + 'px' : '';
    });
  }

  function decorate({ row, key }) {
    if (!row.hasAttribute('data-gbd-row')) {
      row.setAttribute('data-gbd-row', '');
      if (getComputedStyle(row).display === 'inline') row.style.display = 'block';
      row.addEventListener('mouseenter', positionQuick);
    }
    if (row.dataset.gbdKey !== key) row.dataset.gbdKey = key;
    if (!row.querySelector(':scope > .gbd-check')) row.append(makeCheck());
    if (!row.querySelector(':scope > .gbd-quick')) row.append(makeQuick());
    row.querySelector(':scope > .gbd-check').setAttribute('aria-checked', String(selected.has(key)));
    setFlag(row, 'data-gbd-selected', selected.has(key));
    setFlag(row, 'data-gbd-pending', pending.has(key));
    setFlag(row, 'data-gbd-failed', failed.has(key));
  }

  function isDark() {
    const b = document.body;
    if (b.classList.contains('dark-theme')) return true;
    if (b.classList.contains('light-theme')) return false;
    const c = getComputedStyle(b).backgroundColor.match(/[\d.]+/g);
    if (c && (c.length < 4 || +c[3] > 0)) return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] < 128;
    return matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function render() {
    html.classList.toggle('gbd-selecting', mode === 'select');
    html.classList.toggle('gbd-running', running);
    bar.classList.toggle('gbd-dark', isDark());
    bar.hidden = !site.isActive() && !running;

    const busy = running || loading;
    const n = selected.size;
    launchBtn.hidden = mode !== 'idle' || busy || !!recording;
    for (const b of [selectAllBtn, loadAllBtn, clearBtn, deleteBtn, closeBtn]) b.hidden = mode !== 'select' || busy;
    debugBtn.hidden = busy;
    debugBtn.classList.toggle('gbd-recording', !!recording);
    stopBtn.hidden = !busy;

    let status = '';
    if (running) status = `Deleting ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`;
    else if (loading) status = `Loading chats… ${items.length}`;
    else if (recording) status = `Recording (${recording.steps.length} clicks). Delete one chat by hand, then click 🐞 again`;
    else if (flashText) status = flashText;
    else if (mode === 'select') status = items.length ? `${n} of ${items.length} selected` : 'No chats found. Open the sidebar.';
    setText(statusEl, status);
    statusEl.hidden = !status;

    setText(deleteLabel, armed ? `Confirm: delete ${n}?` : `Delete ${n}`);
    deleteBtn.disabled = !n;
    deleteBtn.classList.toggle('gbd-armed', armed);
    clampBar();
  }

  function scan() {
    items = site.findChats();
    for (const item of items) decorate(item);
    if (!bar.isConnected) document.body.append(bar);
    render();
  }

  // ---------- toolbar position ----------

  function placeBar(x, y) {
    const r = bar.getBoundingClientRect();
    bar.style.left = Math.round(Math.min(Math.max(4, x), innerWidth - r.width - 4)) + 'px';
    bar.style.top = Math.round(Math.min(Math.max(4, y), innerHeight - r.height - 4)) + 'px';
    bar.style.transform = 'none';
  }

  function clampBar() {
    if (!bar.style.left || !bar.isConnected || bar.hidden) return;
    const r = bar.getBoundingClientRect();
    if (r.right > innerWidth - 4 || r.bottom > innerHeight - 4 || r.left < 4 || r.top < 4) placeBar(r.left, r.top);
  }

  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const r = bar.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    grip.setPointerCapture(e.pointerId);
    const move = (ev) => placeBar(ev.clientX - dx, ev.clientY - dy);
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      try { localStorage.setItem(POS_KEY, JSON.stringify({ x: parseFloat(bar.style.left), y: parseFloat(bar.style.top) })); } catch {}
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });

  // ---------- page-level listeners ----------

  // In selection mode a click anywhere on a chat row selects it instead of opening it.
  // Registered on window so it runs before the page's own document-level handlers.
  addEventListener('click', (e) => {
    if (mode !== 'select' || running || !e.isTrusted) return;
    const t = e.target;
    if (!(t instanceof Element) || t.closest('.gbd-ui')) return;
    const row = t.closest('[data-gbd-row]');
    if (!row) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    toggle(row.dataset.gbdKey, e.shiftKey);
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.isTrusted && e.key === 'Escape' && mode === 'select' && !running && ![...document.querySelectorAll(DIALOGS)].some(isVisible)) exitSelect();
  });

  addEventListener('resize', clampBar);

  let scanQueued = false;
  new MutationObserver((muts) => {
    if (scanQueued || muts.every((m) => m.target instanceof Element && m.target.closest('.gbd-ui'))) return;
    scanQueued = true;
    setTimeout(() => { scanQueued = false; scan(); }, 150);
  }).observe(document.body, { childList: true, subtree: true });

  scan();
  try {
    const pos = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (pos) placeBar(pos.x, pos.y);
  } catch {}
})();
