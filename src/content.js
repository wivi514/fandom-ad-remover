/**
 * Fandom Ad Remover — content script (runs at document_start, in every frame).
 *
 * Two layers:
 *   1. A <style> injected synchronously before the page has any body, so an ad
 *      slot never paints even for one frame.
 *   2. A MutationObserver that deletes the slot elements outright, climbing up
 *      through wrapper divs that exist only to reserve height for that slot.
 *      This is what actually kills the empty white box — CSS alone leaves the
 *      wrapper's own min-height/padding behind.
 */

(() => {
  'use strict';

  const { selectors: AD_SELECTORS, css: AD_CSS } = globalThis.FAR_RULES;
  const SELECTOR = buildSelector();
  const MAX_CLIMB = 4;

  /**
   * Only ever collapse anonymous layout boxes. Sites put ad slots inside real
   * landmarks — Metacritic's top leaderboard is the first child of <header>,
   * with the nav after it — and deleting one of those takes the page with it.
   */
  const CLIMBABLE = new Set(['DIV', 'SPAN']);

  /** Parents awaiting collapse until the parser stops feeding them children. */
  const pendingParents = new Set();

  let enabled = true;
  let removedCount = 0;
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
    styleEl.textContent = AD_CSS;
    (document.head || document.documentElement).appendChild(styleEl);
  }

  function remove(el) {
    const parent = el.parentElement;
    el.remove();
    removedCount++;
    if (!parent) return;

    // Mid-parse, a parent that looks empty may simply not have received its
    // real children yet. Deleting it now detaches it from the document while
    // the parser keeps appending into it, so everything that followed the ad
    // in the source silently disappears. Wait until the document is complete.
    if (document.readyState === 'loading') pendingParents.add(parent);
    else collapseBareAncestors(parent);
  }

  /**
   * Walk up from a removed slot deleting wrappers that are now completely
   * empty — that's where the reserved min-height lives, and it's what leaves
   * the white box behind if we only remove the slot itself.
   */
  function collapseBareAncestors(start) {
    let node = start;

    for (let i = 0; i < MAX_CLIMB; i++) {
      if (!node || !node.isConnected) return;
      if (!CLIMBABLE.has(node.tagName)) return;
      if (node.children.length > 0 || node.textContent.trim() !== '') return;

      const parent = node.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) return;

      node.remove();
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
      remove(node);
      return;
    }
    for (const hit of node.querySelectorAll(SELECTOR)) {
      // An earlier removal in this batch may have taken this one with it.
      if (hit.isConnected) remove(hit);
    }
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
      // id once the ad script initialises them.
      attributeFilter: ['class', 'id'],
    });

    document.addEventListener('DOMContentLoaded', () => {
      sweep(document.documentElement);
      flushPendingCollapses();
    });
    sweep(document.documentElement);
  }

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
      sendResponse({ host, enabled, removed: removedCount });
    } else if (msg.type === 'far:setEnabled') {
      msg.value ? resume() : stop();
      sendResponse({ ok: true });
    }
  });
})();
