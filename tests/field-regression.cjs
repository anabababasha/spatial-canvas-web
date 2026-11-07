const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const syntax = require('node:child_process').spawnSync(process.execPath, ['--input-type=module', '--check'], {input:script, encoding:'utf8'});
assert.equal(syntax.status, 0, syntax.stderr);
function fn(name) {
  const start = script.indexOf(`    function ${name}(`);
  assert(start >= 0, name);
  let pos = script.indexOf('{', start), depth = 1, end = pos + 1;
  for (; depth; end++) { if (script[end] === '{') depth++; if (script[end] === '}') depth--; }
  return script.slice(start, end);
}
class Element {
  constructor(name, value = null) { this.nodeName = name; this.nodeType = name === '#text' ? 3 : 1; this.nodeValue = value; this.childNodes = []; this.hidden = false; this.scrollTop = 0; this.classList = {add(){},remove(){}}; }
  append(...nodes) { for (const n of nodes) { n.parent = this; this.childNodes.push(n); } }
  replaceChildren(...nodes) { this.childNodes = []; this.append(...nodes); }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get lastChild() { return this.childNodes.at(-1); }
  set textContent(v) { this.replaceChildren(new Element('#text', String(v))); }
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(n => n.textContent).join(' '); }
  remove() { this.parent.childNodes.splice(this.parent.childNodes.indexOf(this), 1); }
  replaceWith(n) { const p = this.parent, i = p.childNodes.indexOf(this); n.parent = p; p.childNodes[i] = n; }
  addEventListener() {}
}
const context = vm.createContext({assert, Date, document: {createElement: n => new Element(n)}, detailPanel: new Element('div'), Element});
vm.runInContext(script.slice(script.indexOf('    const COMPANY_NAMES'), script.indexOf('    function bytesHex')) + '\n' +
 ['classifySignal','updateInspectorContent','openEntityPopup','dismissPopup','selectEntity'].map(fn).join('\n') + `
let selectedEntity = null;
const NEARBY_MS = 30000;
const isFresh = e => Date.now() - Date.parse(e.lastSeen) <= NEARBY_MS;
const validRssi = Number.isFinite, validTxPower = Number.isFinite;
`, context);
vm.runInContext(`
const info = (name, uuids) => ({name, advertisedName:name, serviceUuids:new Set(uuids), manufacturerIds:new Set(), iBeacon:false});
assert.equal(identifySignal(info('Hue bulb',['fe0f'])).basis, 'name-and-service');
assert.equal(classifySignal(info('Hue bulb',['fe0f'])).category, 'iot');
assert.equal(identifySignal(info('Hue bulb',[])).family, null);
assert.equal(identifySignal(info('', ['fe0f'])).family, null);
assert.equal(classifySignal(info('', [])).category, 'unresolved');
assert.equal(identifySignal(info('Hue bulb',['fe0f'])).exactModel, null);
assert.match(identifySignal(info('', ['180a'])).nextStep, /authorized read/);
function entity(id) { return {number:id, name:'Device '+id, card:new Element('article'), manufacturerIds:[], serviceUuids:[], lastSeen:new Date().toISOString(), firstSeen:new Date().toISOString(), packets:1}; }
const a = entity(1), b = entity(2);
selectEntity(a);
assert(a.popup.isOpen());
selectEntity(b);
assert(!a.popup.isOpen());
assert(b.popup.isOpen());
b.lastSeen = new Date(Date.now()-60000).toISOString();
b.card.hidden = true;
detailPanel.scrollTop = 250;
const content = detailPanel.children[1];
const advanced = content.children.at(-1);
advanced.open = true;
b.packets = 42;
openEntityPopup(b, true);
assert(b.popup.isOpen());
assert.equal(detailPanel.children[1], content);
assert.equal(content.children.at(-1), advanced);
assert.equal(advanced.open, true);
assert.equal(detailPanel.scrollTop, 250);
assert.match(content.textContent, /Packets: 42/);
assert.match(content.textContent, /inspector pinned/);
selectEntity(b);
assert(b.popup.isOpen());
dismissPopup();
assert(detailPanel.hidden);
`, context);
assert(!fn('updateCards').includes('dismissPopup'));
assert(!fn('setView').includes('dismissPopup'));
assert(!fn('recenterToGps').includes('dismissPopup'));
console.log('PASS: syntax, evidence positive/negative cases, selection ownership, aging/filter persistence, live text update, scroll/details preservation, explicit close. DOM stub; not a browser or hardware test.');
