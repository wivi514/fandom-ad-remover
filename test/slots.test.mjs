import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const rules = readFileSync(`${ROOT}/src/rules.js`, 'utf8');
const content = readFileSync(`${ROOT}/src/content.js`, 'utf8');

const results = [];
const check = (name, pass) => results.push([name, pass]);
const tick = () => new Promise((r) => setTimeout(r, 20));

/** Boot a document with the content script loaded, as the extension would. */
function load(html, { readyState } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  if (readyState) {
    Object.defineProperty(dom.window.document, 'readyState', { value: readyState, configurable: true });
  }
  dom.window.chrome = {
    storage: { local: { get: (defaults, cb) => cb(defaults) } },
    runtime: { lastError: null, onMessage: { addListener: () => {} } },
  };
  dom.window.eval(rules);
  dom.window.eval(content);
  return dom;
}

const isHidden = (el) => !!el && el.hasAttribute('data-far-hidden');
const stillThere = (el) => !!el && el.isConnected;

// --- core behaviour ----------------------------------------------------------
{
  const HTML = `<!doctype html><html><body>
    <article id="story">
      <div class="header">Real header</div>
      <div class="loading-spinner">spinner</div>
      <div class="shadow-panel">shadow</div>
      <a class="download-link">download</a>
      <p class="lead">Article text</p>

      <div class="js-ad-wrap ad-wrap ad-wrap--top" style="min-height:250px">
        <div class="fandom-ad" id="fandom-ad-top"></div>
      </div>

      <div id="mixed"><span>caption</span><div class="fandom-ad"></div></div>
      <div class="ad-container"><div class="inner"><div id="div-gpt-ad-1"></div></div></div>
      <div class="gallery"><img src="x.png"></div>
    </article>
  </body></html>`;

  const dom = load(HTML);
  const doc = dom.window.document;
  const $ = (s) => doc.querySelector(s);
  await tick();

  check('style injected', !!$('style') && $('style').textContent.includes('fandom-ad'));
  check('slot hidden but left in the DOM', isHidden($('#fandom-ad-top')) && stillThere($('#fandom-ad-top')));
  check('bare .ad-wrap wrapper hidden too', isHidden($('.ad-wrap')));
  check('mixed wrapper stays visible (has a real caption)', !isHidden($('#mixed')));
  check('  ...but its ad child is hidden', isHidden($('#mixed .fandom-ad')));
  check('nested gpt slot hidden', isHidden($('#div-gpt-ad-1')));
  check('.ad-container hidden', isHidden($('.ad-container')));
  check('inner wrapper between them hidden', isHidden($('.ad-container .inner')));

  for (const sel of ['.header', '.loading-spinner', '.shadow-panel', '.download-link', '.lead', '.gallery']) {
    check(`${sel} untouched`, stillThere($(sel)) && !isHidden($(sel)));
  }

  // --- ads injected after load
  const late = doc.createElement('div');
  late.className = 'wrapper-later';
  late.innerHTML = '<div class="ad-slot" id="late-ad" style="height:600px"></div>';
  $('#story').appendChild(late);
  await tick();
  check('late-inserted ad hidden', isHidden($('#late-ad')));
  check('its bare wrapper hidden', isHidden($('.wrapper-later')));

  // --- slot that only gets its class after insertion
  const blank = doc.createElement('div');
  blank.id = 'blank-slot';
  $('#story').appendChild(blank);
  await tick();
  check('blank div left alone until classed', !isHidden($('#blank-slot')));
  blank.className = 'fandom-ad-leaderboard';
  await tick();
  check('hidden once fandom-ad class appears', isHidden($('#blank-slot')));
}

// --- regression: Metacritic puts its top leaderboard inside <header>, before
// --- the nav. Mid-parse that header looks like a bare ad wrapper.
{
  const dom = load('<!doctype html><html><body></body></html>', { readyState: 'loading' });
  const doc = dom.window.document;

  const isolate = doc.createElement('div');
  isolate.className = 'isolate';
  doc.body.appendChild(isolate);
  const header = doc.createElement('header');
  header.className = 'c-site-header';
  isolate.appendChild(header);
  const adWrap = doc.createElement('div');
  adWrap.className = 'fandom-ad-sticky-container fandom-ad-placeholder';
  header.appendChild(adWrap);
  await tick();

  check('mid-parse: <header> not hidden', !isHidden(header));
  check('mid-parse: page wrapper not hidden', !isHidden(isolate));
  check('mid-parse: the slot itself is hidden', isHidden(adWrap));

  const nav = doc.createElement('nav');
  nav.innerHTML = '<a href="/games">Games</a><a href="/movies">Movies</a>';
  header.appendChild(nav);
  Object.defineProperty(doc, 'readyState', { value: 'interactive', configurable: true });
  doc.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await tick();

  check('nav streamed in after the ad is intact', doc.querySelectorAll('header nav a').length === 2);
  check('nav is not hidden', !isHidden(nav));
}

// The slot node itself is never detached — Metacritic's header script keeps a
// reference to it and stops rendering the desktop nav if it disappears.
{
  const dom = load('<!doctype html><body><header id="h"><div class="fandom-ad" id="slot"></div></header><p>x</p>');
  await tick();
  const doc = dom.window.document;
  check('post-load: <header> is not hidden', !isHidden(doc.querySelector('#h')));
  check('post-load: its ad child is hidden', isHidden(doc.querySelector('#slot')));
  check('post-load: the slot node still exists', stillThere(doc.querySelector('#slot')));
}

// --- markup copied verbatim from the live sites (see README site list) -------
const SAMPLES = {
  'gamespot.com': '<div class="js-ad-wrap ad-wrap ad-wrap--top"><div class="fandom-ad" id="t"></div></div>',
  'metacritic.com':
    '<div class="fandom-ad-wrapper fandom-ad-placeholder min-w-[300px] min-h-[250px] fandom-ad-slot-type-display top-ads-container">' +
    '<div class="fandom-ad-label ae-translatable-label">Advertisement</div></div>',
  'fandom.com wiki':
    '<div class="top_leaderboard-odyssey-wrapper fandom-ad-sticky-container sticky-placement-top fandom-ad-placeholder fandom-ad-slot-top_leaderboard"></div>',
  'gamefaqs.gamespot.com': '<div class="ad_wrap "><div class="js-mapped-ad ad ad_leader_plus_top"></div></div>',
  'comicvine.gamespot.com':
    '<div class="ad-wrap ad-wrap-leader_bottom"><div class="js-mapped-ad mapped-ad mapped-leader_bottom"></div></div>',
};

for (const [site, markup] of Object.entries(SAMPLES)) {
  const dom = load(`<!doctype html><body><main><p class="keep">text</p>${markup}</main></body>`);
  await tick();
  const doc = dom.window.document;
  check(`real markup: ${site} outermost wrapper hidden`, isHidden(doc.querySelector('main > *:last-child')));
  check(`real markup: ${site} content kept visible`, !isHidden(doc.querySelector('.keep')));
}

// "ad-settings" (Comic Vine) is a user-facing preferences control, not a slot
{
  const dom = load('<!doctype html><body><div class="ad-settings">Ad settings</div>');
  await tick();
  check('ad-settings control stays visible', !isHidden(dom.window.document.querySelector('.ad-settings')));
}

// --- disabling restores the page live, since nothing was ever detached -------
{
  const dom = new JSDOM(
    '<!doctype html><body><div class="wrap"><div class="fandom-ad" id="a"></div></div><p>keep</p>',
    { runScripts: 'outside-only', url: 'https://www.gamespot.com/' }
  );
  dom.window.chrome = {
    storage: { local: { get: (d, cb) => cb({ ...d, enabled: true, disabledSites: ['gamespot.com'] }) } },
    runtime: { lastError: null, onMessage: { addListener: () => {} } },
  };
  dom.window.eval(rules);
  dom.window.eval(content);
  await tick();

  const doc = dom.window.document;
  check('disabled site: style withdrawn', !doc.querySelector('style'));
  check('disabled site: nothing left marked hidden', !doc.querySelector('[data-far-hidden]'));
  check('disabled site: slot still present', !!doc.querySelector('#a'));

  const fresh = doc.createElement('div');
  fresh.className = 'fandom-ad';
  fresh.id = 'after-disable';
  doc.body.appendChild(fresh);
  await tick();
  check('disabled site: new slots untouched', !isHidden(doc.querySelector('#after-disable')));
}

let failed = 0;
for (const [name, pass] of results) {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
