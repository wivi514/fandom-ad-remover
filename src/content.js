/**
 * Fandom Ad Remover — content script (runs at document_start, in every frame).
 *
 * It *hides* ad slots rather than deleting them. That distinction matters:
 * Metacritic's header script keeps a reference to its leaderboard container,
 * and deleting that node makes it give up before rendering the desktop nav
 * bar, so the whole logo/search/menu strip disappears. Hiding leaves the node
 * in place for the site's own code while still collapsing the layout box, so
 * no empty white gap remains. Verified against the live site both ways.
 *
 * Two layers:
 *   1. A <style> injected synchronously before the page has any body, so a
 *      slot never paints even for one frame.
 *   2. A MutationObserver that marks slots as they appear, then walks up to
 *      hide wrappers left holding nothing but a hidden slot — that wrapper is
 *      usually where the reserved min-height lives.
 */

(() => {
  'use strict';

  const { selectors: AD_SELECTORS, css: AD_CSS } = globalThis.FAR_RULES;
  const SELECTOR = buildSelector();
  const MAX_CLIMB = 4;

  /** Marks what we hid, so it can all be undone and counted. */
  const HIDDEN_ATTR = 'data-far-hidden';

  /**
   * Only ever collapse anonymous layout boxes. Sites put ad slots inside real
   * landmarks — Metacritic's top leaderboard is the first child of <header>,
   * with the nav after it — and hiding one of those takes the page with it.
   */
  const CLIMBABLE = new Set(['DIV', 'SPAN']);

  /** Nodes that never count as visible content when judging a wrapper. */
  const NOT_CONTENT = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'LINK', 'META']);

  /** Parents awaiting collapse until the parser stops feeding them children. */
  const pendingParents = new Set();

  let enabled = true;
  let hiddenCount = 0;
  let styleEl = null;
  let observer = null;

  /**
   * Drop any selector this browser doesn't understand rather than letting one
   * bad entry break querySelectorAll for the whole list.
   */
  function buildSelector() {
    const usable = AD_SELECTORS.filter((sel) => {
      try {
        document.documentElement.matches(sel);
        return true;
      } catch {
        return false;
      }
    });
    return usable.join(',');
  }

  function injectStyle() {
    if (styleEl && styleEl.isConnected) return;
    styleEl = document.createElement('style');
    styleEl.textContent = `${AD_CSS}\n[${HIDDEN_ATTR}] {\n  display: none !important;\n}\n`;
    (document.head || document.documentElement).appendChild(styleEl);
  }

  function isHidden(el) {
    return el.hasAttribute(HIDDEN_ATTR) || (SELECTOR && el.matches(SELECTOR));
  }

  /** True when everything left in `node` is either hidden by us or ignorable. */
  function isVisuallyEmpty(node) {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (child.data.trim() !== '') return false;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (NOT_CONTENT.has(child.tagName)) continue;
        if (!isHidden(child)) return false;
      }
    }
    return true;
  }

  function hide(el) {
    if (el.hasAttribute(HIDDEN_ATTR)) return;
    el.setAttribute(HIDDEN_ATTR, '');
    hiddenCount++;

    const parent = el.parentElement;
    if (!parent) return;

    // Mid-parse, a parent that looks empty may simply not have received its
    // real children yet — hiding it would take everything that follows the ad
    // in the source with it. Wait until the document is complete.
    if (document.readyState === 'loading') pendingParents.add(parent);
    else collapseBareAncestors(parent);
  }

  /**
   * Walk up from a hidden slot, hiding wrappers that now hold nothing visible.
   * That wrapper is where the reserved min-height usually lives, and it's what
   * leaves the white box behind if only the slot itself is hidden.
   */
  function collapseBareAncestors(start) {
    let node = start;

    for (let i = 0; i < MAX_CLIMB; i++) {
      if (!node || !node.isConnected) return;
      if (!CLIMBABLE.has(node.tagName)) return;

      const parent = node.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) return;

      if (!node.hasAttribute(HIDDEN_ATTR)) {
        if (!isVisuallyEmpty(node)) return;
        node.setAttribute(HIDDEN_ATTR, '');
      }
      node = parent;
    }
  }

  function flushPendingCollapses() {
    for (const parent of pendingParents) collapseBareAncestors(parent);
    pendingParents.clear();
  }

  function sweep(node) {
    if (!enabled || !SELECTOR) return;
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

    if (node.matches(SELECTOR)) {
      hide(node);
      return;
    }
    for (const hit of node.querySelectorAll(SELECTOR)) hide(hit);
  }

  function start() {
    injectStyle();
    if (observer) return;

    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes') {
          sweep(m.target);
          continue;
        }
        for (const node of m.addedNodes) sweep(node);
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      // Slots are frequently blank at insert time and only get their class or
      // id once the ad script initialises them. HIDDEN_ATTR is deliberately
      // not in this list, so our own marking doesn't re-trigger the observer.
      attributeFilter: ['class', 'id'],
    });

    document.addEventListener('DOMContentLoaded', () => {
      sweep(document.documentElement);
      flushPendingCollapses();
    });
    sweep(document.documentElement);
  }

  /** Fully reversible, because nothing was ever detached. */
  function stop() {
    enabled = false;
    pendingParents.clear();

    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (styleEl) {
      styleEl.remove();
      styleEl = null;
    }
    for (const el of document.querySelectorAll(`[${HIDDEN_ATTR}]`)) el.removeAttribute(HIDDEN_ATTR);
    hiddenCount = 0;
  }

  function resume() {
    enabled = true;
    start();
  }

  const host = location.hostname.replace(/^www\./, '');

  start();

  // storage is async, so we start optimistically and back out if this site (or
  // the extension as a whole) is switched off. Nothing paints in between.
  chrome.storage.local.get({ enabled: true, disabledSites: [] }, (cfg) => {
    if (chrome.runtime.lastError) return;
    if (!cfg.enabled || cfg.disabledSites.includes(host)) stop();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'far:stats') {
      sendResponse({ host, enabled, hidden: hiddenCount });
    } else if (msg.type === 'far:setEnabled') {
      msg.value ? resume() : stop();
      sendResponse({ ok: true });
    }
  });
})();
