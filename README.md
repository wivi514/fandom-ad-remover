# Fandom Ad Remover

A Manifest V3 extension for Brave, Chrome, Edge, Vivaldi, Opera and any other
Chromium browser. It collapses the containers ad blockers leave behind — the
`fandom-ad` divs and their reserved-height wrappers — so sites like GameSpot,
Fandom wikis, GameFAQs and Metacritic don't show empty white boxes where the
ads used to be.

It does **not** block ads. Keep using uBlock Origin / Brave Shields for that;
this just cleans up the holes.

## Install

1. Open `brave://extensions` (or `chrome://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this folder.

Pin the icon if you want the toggle handy. To update, hit the reload arrow on
the extension card after editing files.

## How it works

It **hides** slots rather than deleting them, marking each one with
`data-far-hidden` and a `display: none !important` rule. A hidden element has no
layout box at all, so the gap closes just as completely as a deletion would —
without taking the node away from the site's own scripts. That distinction is
not theoretical: see *Why hide and not delete* below.

`src/content.js` runs at `document_start` in every frame and does two things:

1. Injects a `<style>` synchronously, so a slot never paints even for one
   frame (no flash of empty box).
2. Runs a `MutationObserver` that marks matching elements as they appear —
   including slots that start blank and only get their class once the ad script
   initialises. After marking a slot it walks up to 4 levels hiding wrappers
   left holding nothing visible, because that outer wrapper is usually the
   thing holding the `min-height` that makes the white gap.

Two guards on that upward walk, both learned the hard way on Metacritic, whose
top leaderboard is the *first child of `<header>`* with the nav after it:

- **Only `<div>` and `<span>` are ever collapsed.** Landmarks like `<header>`,
  `<nav>` and `<main>` are left alone however empty they look.
- **Nothing is collapsed while `document.readyState === 'loading'`.** Mid-parse,
  a parent that looks empty may just not have received its real children yet.
  Collapses are queued and flushed at `DOMContentLoaded`. The slot itself is
  marked immediately, and the CSS keeps it from painting in the meantime.

## Why hide and not delete

The first version really did `.remove()` the slots, and it broke Metacritic:
the whole logo/search/nav strip vanished. Their header script holds a reference
to the leaderboard container, and when that node disappears it never renders the
desktop nav bar — the bar isn't hidden, it is never built. Confirmed by loading
the extension in headless Chromium against the live site:

| build | `<header>` height | nav links rendered | ad gap |
|---|---|---|---|
| no extension | 348px | 83 | present |
| delete nodes | 0px | 0 | gone |
| hide nodes | 64px | 83 | gone |

Hiding gets the same visual result with none of the collateral damage, so that
is what it does. It also makes the popup's off switch reversible on the spot.

## Toolbar popup

- **Active on this site** — per-hostname off switch, remembered in
  `chrome.storage.local`.
- **Extension enabled** — global off switch.
- Shows how many slots were hidden on the current page.

Turning it off un-hides everything immediately — no reload needed, because
nothing was ever detached.

## Tuning the rules

All selectors live in `src/rules.js` — one array, used for both the CSS and the
DOM walk. Add a selector there and reload the extension.

`SITE_SELECTORS` in the same file is for clutter that is *not* an ad, so it
must never go in the global list. Entries are keyed by domain (subdomains
included) and apply only there — for example `.c-section-about__overlay`, the
decorative pink gradient panel on Metacritic's "Gold Standard" section. A
global `[class*="overlay"]` rule would break half the web; a per-site one is
safe.

The one rule when adding entries: the selector must only ever match an element
whose entire purpose is holding an ad. A bare `[class*="ad"]` is not safe — it
matches `header`, `loading`, `shadow`, `download`, `thread`, and will eat real
content.

If a page breaks, flip the site toggle off and open devtools to see which
selector was too greedy.

## Tests

```
npm install   # jsdom, dev-only — not part of the extension
npm test
```

`test/slots.test.mjs` runs the real `rules.js` + `content.js` against a
GameSpot-shaped DOM and checks both directions: ad slots and their bare
wrappers get hidden (including ones inserted late or classed late), while
`header` / `loading` / `shadow` / `download` elements and article content are
left alone. It also replays the Metacritic parse-order case and the verbatim
markup of all five sites listed above. Run it after editing the selector list.
