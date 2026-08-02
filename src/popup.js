'use strict';

const els = {
  host: document.getElementById('host'),
  count: document.getElementById('count'),
  site: document.getElementById('site'),
  global: document.getElementById('global'),
};

let host = null;
let tabId = null;

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Talk to the top frame only — all_frames means every iframe would answer. */
async function ask(message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  } catch {
    return null; // no content script here (chrome://, web store, file picker…)
  }
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  host = hostOf(tab?.url || '');

  const cfg = await chrome.storage.local.get({ enabled: true, disabledSites: [] });
  els.global.checked = cfg.enabled;
  els.site.checked = host ? !cfg.disabledSites.includes(host) : false;
  els.site.disabled = !host || !cfg.enabled;

  const stats = tabId != null ? await ask({ type: 'far:stats' }) : null;
  els.host.textContent = host || 'no page';
  els.count.textContent = stats
    ? `${stats.hidden} slot${stats.hidden === 1 ? '' : 's'} hidden`
    : 'not running on this page';
}

async function setSiteEnabled(on) {
  if (!host) return;
  const { disabledSites } = await chrome.storage.local.get({ disabledSites: [] });
  const next = disabledSites.filter((h) => h !== host);
  if (!on) next.push(host);

  await chrome.storage.local.set({ disabledSites: next });
  await ask({ type: 'far:setEnabled', value: on });
}

async function setGlobalEnabled(on) {
  await chrome.storage.local.set({ enabled: on });
  els.site.disabled = !on || !host;

  if (on && host) {
    const { disabledSites } = await chrome.storage.local.get({ disabledSites: [] });
    if (disabledSites.includes(host)) return; // stays off for this site
  }
  await ask({ type: 'far:setEnabled', value: on });
}

els.site.addEventListener('change', (e) => setSiteEnabled(e.target.checked));
els.global.addEventListener('change', (e) => setGlobalEnabled(e.target.checked));

init();
