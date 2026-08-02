# Fandom Ad Remover

A Manifest V3 extension for Brave, Chrome, Edge, Vivaldi, Opera and any other
Chromium browser. It deletes the containers ad blockers leave behind — the
`fandom-ad` divs and their reserved-height wrappers — so sites like GameSpot,
Fandom wikis, GiantBomb and Metacritic don't show empty white boxes where the
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

`src/content.js` runs at `document_start` in every frame and does two things:

1. Injects a `<style>` synchronously, so a slot never paints even for one
   frame (no flash of empty box).
2. Runs a `MutationObserver` that removes matching elements as they appear —
   including slots that start blank and only get their class once the ad script
   initialises. After removing a slot it walks up to 4 levels deleting wrappers
   that are now completely empty, because that outer wrapper is usually the
   thing holding the `min-height` that makes the white gap.

Two guards on that upward walk, both learned the hard way on Metacritic, whose
top leaderboard is the *first child of `<header>`* with the nav after it:

- **Only `<div>` and `<span>` are ever collapsed.** Landmarks like `<header>`,
  `<nav>` and `<main>` are left alone however empty they look.
- **Nothing is collapsed while `document.readyState === 'loading'`.** Mid-parse,
  a parent that looks empty may just not have received its real children yet;
  removing it detaches it while the parser keeps appending into it, so
  everything after the ad in the source silently vanishes. Collapses are queued
  and flushed at `DOMContentLoaded`. The slot itself still goes immediately.

## Toolbar popup

- **Active on this site** — per-hostname off switch, remembered in
  `chrome.storage.local`.
- **Extension enabled** — global off switch.
- Shows how many slots were removed on the current page.

Turning it off stops further removals immediately; reload the page to bring
back slots that were already deleted.

## Tuning the rules

All selectors live in `src/rules.js` — one array, used for both the CSS and the
DOM removal. Add a selector there and reload the extension.

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

`test/removal.test.mjs` runs the real `rules.js` + `content.js` against a
GameSpot-shaped DOM and checks both directions: ad slots and their bare
wrappers get removed (including ones inserted late or classed late), while
`header` / `loading` / `shadow` / `download` elements and article content are
left alone. Run it after editing the selector list.
