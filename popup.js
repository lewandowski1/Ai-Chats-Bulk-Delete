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
