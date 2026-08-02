import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const rules = readFileSync(`${ROOT}/src/rules.js`, 'utf8');
const content = readFileSync(`${ROOT}/src/content.js`, 'utf8');

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

const dom = new JSDOM(HTML, { runScripts: 'outside-only' });
const { window } = dom;
const stored = { enabled: true, disabledSites: [] };
window.chrome = {
  storage: { local: { get: (defaults, cb) => cb({ ...defaults, ...stored }) } },
  runtime: { lastError: null, onMessage: { addListener: () => {} } },
};

window.eval(rules);
window.eval(content);

const $ = (sel) => window.document.querySelector(sel);
const results = [];
const check = (name, pass) => results.push([name, pass]);

await new Promise((r) => setTimeout(r, 20));

check('style injected', !!$('style') && $('style').textContent.includes('fandom-ad'));
check('fandom-ad slot gone', !$('#fandom-ad-top'));
check('bare .ad-wrap wrapper collapsed too', !$('.ad-wrap'));
check('mixed wrapper kept (has real caption)', !!$('#mixed') && !!$('#mixed span'));
check('  ...but its ad child removed', $('#mixed .fandom-ad') === null);
check('nested gpt slot + ad-container gone', !$('#div-gpt-ad-1') && !$('.ad-container'));

check('.header survives', !!$('.header'));
check('.loading-spinner survives', !!$('.loading-spinner'));
check('.shadow-panel survives', !!$('.shadow-panel'));
check('.download-link survives', !!$('.download-link'));
check('article text survives', !!$('.lead'));
check('gallery survives', !!$('.gallery img'));

// --- dynamic insertion (the real-world case: ad script injects the slot later)
const late = window.document.createElement('div');
late.className = 'wrapper-later';
late.innerHTML = '<div class="ad-slot" id="late-ad" style="height:600px"></div>';
$('#story').appendChild(late);
await new Promise((r) => setTimeout(r, 20));
check('late-inserted ad removed', !$('#late-ad'));
check('its bare wrapper removed', !$('.wrapper-later'));

// --- slot that only gets its class after insertion
const blank = window.document.createElement('div');
blank.id = 'blank-slot';
$('#story').appendChild(blank);
await new Promise((r) => setTimeout(r, 20));
check('blank div left alone until classed', !!$('#blank-slot'));
blank.className = 'fandom-ad-leaderboard';
await new Promise((r) => setTimeout(r, 20));
check('removed once fandom-ad class appears', !$('#blank-slot'));

// --- per-site disable
const dom2 = new JSDOM('<!doctype html><body><div class="fandom-ad" id="a"></div></body>', {
  runScripts: 'outside-only',
  url: 'https://www.gamespot.com/',
});
dom2.window.chrome = {
  storage: { local: { get: (d, cb) => cb({ ...d, enabled: true, disabledSites: ['gamespot.com'] }) } },
  runtime: { lastError: null, onMessage: { addListener: () => {} } },
};
dom2.window.eval(rules);
dom2.window.eval(content);
await new Promise((r) => setTimeout(r, 20));
// already-removed nodes stay gone, but the style must be withdrawn and the
// observer stopped, so newly added slots survive
const fresh = dom2.window.document.createElement('div');
fresh.className = 'fandom-ad';
fresh.id = 'after-disable';
dom2.window.document.body.appendChild(fresh);
await new Promise((r) => setTimeout(r, 20));
check('disabled site: style withdrawn', !dom2.window.document.querySelector('style'));
check('disabled site: new slots untouched', !!dom2.window.document.querySelector('#after-disable'));

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
  const d = new JSDOM(`<!doctype html><body><main><p class="keep">text</p>${markup}</main></body>`, {
    runScripts: 'outside-only',
  });
  d.window.chrome = {
    storage: { local: { get: (defaults, cb) => cb(defaults) } },
    runtime: { lastError: null, onMessage: { addListener: () => {} } },
  };
  d.window.eval(rules);
  d.window.eval(content);
  await new Promise((r) => setTimeout(r, 20));
  const main = d.window.document.querySelector('main');
  check(`real markup: ${site} slot removed`, main.children.length === 1);
  check(`real markup: ${site} content kept`, !!d.window.document.querySelector('.keep'));
}

// "ad-settings" (Comic Vine) is a user-facing preferences control, not a slot
const settings = new JSDOM('<!doctype html><body><div class="ad-settings">Ad settings</div>', {
  runScripts: 'outside-only',
});
settings.window.chrome = {
  storage: { local: { get: (defaults, cb) => cb(defaults) } },
  runtime: { lastError: null, onMessage: { addListener: () => {} } },
};
settings.window.eval(rules);
settings.window.eval(content);
await new Promise((r) => setTimeout(r, 20));
check('ad-settings control survives', !!settings.window.document.querySelector('.ad-settings'));

let failed = 0;
for (const [name, pass] of results) {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
