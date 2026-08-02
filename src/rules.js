/**
 * Selector list shared by content.js.
 *
 * Content scripts from the same extension share one isolated world; this file
 * is listed first in the manifest and hands its rules over on globalThis.
 *
 * Rule of thumb for adding entries: the selector must only ever match a slot
 * whose *entire* purpose is holding an ad. Substring matches on "ad" alone are
 * off limits — they hit "header", "loading", "shadow", "download", ...
 */

const AD_SELECTORS = [
  // --- The one the user actually asked about --------------------------------
  '[class*="fandom-ad" i]',
  '[id*="fandom-ad" i]',

  // --- Fandom / GameSpot / GiantBomb / Metacritic slot wrappers -------------
  '[class*="ad-wrap" i]',
  '[class*="adwrap" i]',
  '[class*="ad-unit" i]',
  '[class*="adunit" i]',
  '[class*="ad-slot" i]',
  '[class*="adslot" i]',
  '[class*="ad-container" i]',
  '[class*="ad-placeholder" i]',
  '[class*="ad-label" i]',
  '[class*="ad-leader" i]',
  '[class*="leaderboard-ad" i]',
  '[class*="sticky-ad" i]',
  '[class*="incontent-ad" i]',
  '[class*="mapped-ad" i]',
  '[class*="wds-ad" i]',
  '[class~="ad"]',
  '[class~="ads"]',
  '[class~="advertisement"]',
  '[data-ad-unit]',
  '[data-ad-slot]',

  // Fandom wiki slot ids (these are the ones that leave tall white gaps)
  '[id*="top_boxad" i]',
  '[id*="top_leaderboard" i]',
  '[id*="bottom_leaderboard" i]',
  '[id*="incontent_boxad" i]',
  '[id*="incontent_player" i]',

  // --- Ad tech containers / iframes -----------------------------------------
  '[id^="div-gpt-ad"]',
  '[id^="gpt-ad"]',
  '[id*="google_ads_iframe"]',
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="googlesyndication.com"]',
  'ins.adsbygoogle',
];

/** Injected at document_start so the box never gets a chance to paint. */
const AD_CSS = AD_SELECTORS.join(',\n') + ' {\n  display: none !important;\n}\n';

globalThis.FAR_RULES = { selectors: AD_SELECTORS, css: AD_CSS };
