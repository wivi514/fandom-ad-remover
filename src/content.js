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

  /**
   * True when `parent` exists solely to hold `child` — that makes it safe to
   * delete the parent instead, taking its reserved height with it.
   */
  function isBareWrapper(parent, child) {
    if (parent.children.length !== 1 || parent.children[0] !== child) return false;
    return parent.textContent.trim() === '';
  }

  function remove(el) {
    let target = el;
    let parent = target.parentElement;

    for (let i = 0; i < MAX_CLIMB; i++) {
      if (!parent || parent === document.body || parent === document.documentElement) break;
      if (!isBareWrapper(parent, target)) break;
      target = parent;
      parent = target.parentElement;
    }

    target.remove();
    removedCount++;
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

    document.addEventListener('DOMContentLoaded', () => sweep(document.documentElement));
    sweep(document.documentElement);
  }

  function stop() {
    enabled = false;
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
