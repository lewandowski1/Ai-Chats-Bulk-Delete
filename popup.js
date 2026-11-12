const $ = (id) => document.getElementById(id);
const fmt = (n) => (n || 0).toLocaleString();

function show(stats = {}) {
  $('total').textContent = fmt(stats.total);
  $('total-label').textContent = stats.total === 1 ? 'chat deleted' : 'chats deleted';
  $('aiMode').textContent = fmt(stats.aiMode);
  $('gemini').textContent = fmt(stats.gemini);
  $('claude').textContent = fmt(stats.claude);
  $('chatgpt').textContent = fmt(stats.chatgpt);
}

$('version').textContent = 'v' + chrome.runtime.getManifest().version;
chrome.storage.local.get('stats').then(({ stats }) => show(stats));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.stats) show(changes.stats.newValue);
});

// Resetting takes a second click so the count isn't lost by accident.
const reset = $('reset');
let armTimer = 0;
reset.addEventListener('click', async () => {
  if (!reset.classList.contains('armed')) {
    reset.classList.add('armed');
    reset.textContent = 'Click again to reset';
    armTimer = setTimeout(() => {
      reset.classList.remove('armed');
      reset.textContent = 'Reset';
    }, 3000);
    return;
  }
  clearTimeout(armTimer);
  await chrome.storage.local.remove('stats');
  show({});
  reset.classList.remove('armed');
  reset.textContent = 'Reset';
});

// ---------- the floating bar's switch ----------

const showBar = $('show-bar');
chrome.storage.sync.get('showBar').then(({ showBar: on }) => {
  showBar.checked = on !== false;
});
showBar.addEventListener('change', () => chrome.storage.sync.set({ showBar: showBar.checked }));

// ---------- this tab: the same buttons as the page's floating bar ----------
// The extension's page script answers in the AI chat sites only, so elsewhere this stays hidden.

const page = $('page');
const deleteBtn = $('act-delete');
const buttons = Object.fromEntries([...document.querySelectorAll('.act')].map((b) => [b.dataset.action, b]));
let tabId = null;
let state = null;
let deleteArmed = false;
let deleteTimer = 0;

async function ask(action) {
  if (tabId === null) return null;
  try {
    return (await chrome.tabs.sendMessage(tabId, { gbd: 'popup', action })) ?? null;
  } catch {
    return null; // not a chat site, or the page hasn't loaded the extension (reload it)
  }
}

function disarm() {
  deleteArmed = false;
  clearTimeout(deleteTimer);
}

function showPage(next) {
  if (next && state && next.selected !== state.selected) disarm();
  state = next;
  page.hidden = !state;
  if (!state) return;

  const { mode, busy, active, selected } = state;
  const selecting = mode === 'select';
  $('page-site').textContent = state.site;
  let status = state.status;
  if (!active && !busy) status = 'Open your chat history on this page to delete chats.';
  else if (!status) status = 'Click Bulk delete, then pick the chats in the sidebar.';
  $('page-status').textContent = status;
  $('page-hint').hidden = !selecting || busy;

  buttons.select.hidden = !active || selecting || busy;
  for (const action of ['selectAll', 'loadAll', 'clear', 'delete', 'done']) buttons[action].hidden = !selecting || busy;
  buttons.stop.hidden = !busy;
  deleteBtn.disabled = !selected;
  deleteBtn.textContent = deleteArmed ? `Confirm: delete ${selected}?` : `Delete ${selected}`;
  deleteBtn.classList.toggle('armed', deleteArmed);
}

for (const [action, button] of Object.entries(buttons)) {
  button.addEventListener('click', async () => {
    // Deleting takes a second click, as in the bar.
    if (action === 'delete' && !deleteArmed) {
      deleteArmed = true;
      clearTimeout(deleteTimer);
      deleteTimer = setTimeout(() => {
        disarm();
        showPage(state);
      }, 4000);
      showPage(state);
      return;
    }
    if (action === 'delete') disarm();
    showPage(await ask(action));
  });
}

chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
  tabId = tab?.id ?? null;
  showPage(await ask());
  // Keep up with the page: selections made there, and the progress of a run.
  setInterval(async () => showPage(await ask()), 500);
});

// Support and website buttons. While a link is null its button shows "Coming soon".
const LINKS = {
  donate: 'https://ko-fi.com/nikma',
  website: 'https://nikma.xyz',
};

for (const [id, url] of Object.entries(LINKS)) {
  const link = document.getElementById(id);
  if (url) {
    link.href = url;
    continue;
  }
  link.classList.add('soon');
  link.setAttribute('aria-disabled', 'true');
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = 'Coming soon';
  link.append(badge);
}
