/**
 * Preloaded with `node --import` so the DOM exists before Vue's runtime-dom
 * module is evaluated. Node 22+ ships read-only globals (`navigator`, `history`
 * is absent entirely), so every override goes through defineProperty.
 */
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';

// The client test bundle imports the CSS Vite extracts from <style scoped>;
// Node cannot load CSS, so those specifiers resolve to an empty module.
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) {
      return { format: 'module', shortCircuit: true, source: 'export default {};' };
    }
    return nextLoad(url, context);
  },
});

const dom = new JSDOM(
  '<!doctype html><html lang="zh-CN"><head></head><body><div id="app"></div></body></html>',
  { url: 'http://localhost/', pretendToBeVisual: true },
);

function define(key, value) {
  Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
}

define('window', dom.window);
define('document', dom.window.document);
define('navigator', dom.window.navigator);
define('history', dom.window.history);
define('location', dom.window.location);
define('localStorage', dom.window.localStorage);
define('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
define('requestAnimationFrame', dom.window.requestAnimationFrame.bind(dom.window));
define('cancelAnimationFrame', dom.window.cancelAnimationFrame.bind(dom.window));
/* ------------------------------------------------------------- matchMedia */

// jsdom ships no matchMedia. The app uses it for the mobile card list and the
// App-mode shell, so the shim below evaluates the handful of queries the app
// asks about against a mutable viewport, and can be driven from the tests via
// `globalThis.__setViewport()` / `__setDisplayMode()`.
let viewportWidth = 1440;
let displayMode = 'browser';
const mediaQueries = new Map();

function evaluateQuery(query) {
  if (/prefers-color-scheme:\s*dark/.test(query)) return false;
  const display = /\(display-mode:\s*([\w-]+)\)/.exec(query);
  if (display) return display[1] === displayMode;
  const max = /\(max-width:\s*(\d+)px\)/.exec(query);
  const min = /\(min-width:\s*(\d+)px\)/.exec(query);
  if (max && viewportWidth > Number(max[1])) return false;
  if (min && viewportWidth < Number(min[1])) return false;
  return Boolean(max || min);
}

function createMediaQueryList(query) {
  const listeners = new Set();
  const mql = {
    media: query,
    onchange: null,
    get matches() {
      return evaluateQuery(query);
    },
    addEventListener: (type, handler) => {
      if (type === 'change') listeners.add(handler);
    },
    removeEventListener: (type, handler) => listeners.delete(handler),
    addListener: (handler) => listeners.add(handler),
    removeListener: (handler) => listeners.delete(handler),
    dispatchEvent: () => true,
    __fire: () => {
      const event = { matches: evaluateQuery(query), media: query };
      for (const handler of listeners) handler(event);
      if (typeof mql.onchange === 'function') mql.onchange(event);
    },
  };
  return mql;
}

function matchMedia(query) {
  const key = String(query);
  if (!mediaQueries.has(key)) mediaQueries.set(key, createMediaQueryList(key));
  return mediaQueries.get(key);
}

function refreshMedia() {
  for (const mql of mediaQueries.values()) mql.__fire();
}

define('matchMedia', matchMedia);
// `window` is the jsdom window, a different object from globalThis — the app
// reads window.matchMedia, so it must be patched there too.
dom.window.matchMedia = matchMedia;
define('__setViewport', (width) => {
  viewportWidth = Number(width) || 1440;
  refreshMedia();
});
define('__setDisplayMode', (mode) => {
  displayMode = mode === 'standalone' ? 'standalone' : 'browser';
  refreshMedia();
});

// DOM constructors Vue's runtime-dom probes with `instanceof`.
const CONSTRUCTORS = [
  'Node', 'Element', 'Text', 'Comment', 'DocumentFragment', 'ShadowRoot', 'Document', 'Window',
  'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement',
  'HTMLButtonElement', 'HTMLAnchorElement', 'HTMLFormElement', 'HTMLLabelElement',
  'SVGElement', 'MathMLElement', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
  'MutationObserver', 'DOMRect', 'Range', 'DOMParser', 'XMLSerializer', 'Image',
  'CSSStyleSheet', 'MediaQueryList',
];

for (const name of CONSTRUCTORS) {
  if (typeof dom.window[name] !== 'undefined') define(name, dom.window[name]);
}
