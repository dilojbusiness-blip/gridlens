const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function harness(t, saved = {}) {
  const dom = new JSDOM('<div id="app"></div>', { runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window;
  const sent = [];
  const snapshots = [];
  w.acquireVsCodeApi = () => ({ getState: () => saved, setState: state => snapshots.push(state), postMessage: message => sent.push(message) });
  w.ResizeObserver = class { observe() {} };
  w.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  w.HTMLDialogElement.prototype.close = function() { this.open = false; this.dispatchEvent(new w.Event('close')); };
  w.confirm = () => true;
  w.eval(fs.readFileSync(path.join(__dirname, '../media/grid.js'), 'utf8'));
  const viewport = w.document.querySelector('.viewport');
  Object.defineProperties(viewport, { clientHeight: { value: 320 }, clientWidth: { value: 640 } });
  const receive = overrides => w.dispatchEvent(new w.MessageEvent('message', {
    data: { type: 'state', version: 1, rows: [['Name', 'Value'], ['First', '20'], ['Second', '3']], readonly: false, delimiter: ',', ...overrides },
    source: null,
  }));
  return { w, sent, snapshots, receive, viewport, query: selector => w.document.querySelector(selector) };
}

test('Host messages with a null source render state and restored sort preferences', t => {
  const h = harness(t, { headers: true, sortColumn: 1, ascending: true });
  h.receive();
  assert.equal(h.query('.cell').textContent, 'Second');
  assert.equal(h.query('[role=status]').textContent.startsWith('2 / 3'), true);
  assert.equal(h.sent[0].type, 'ready');
});

test('Click retains the cell DOM node so a real double-click can open the editor', t => {
  const h = harness(t); h.receive();
  const cell = h.query('.cell[data-row="1"][data-column="0"]');
  cell.click();
  assert.equal(cell.isConnected, true);
  cell.dispatchEvent(new h.w.MouseEvent('dblclick', { bubbles: true }));
  assert.equal(h.query('dialog').open, true);
  h.query('textarea').value = '雪\n<img onerror="bad">';
  h.query('dialog button').click();
  const message = h.sent.at(-1);
  assert.equal(message.type, 'edit'); assert.equal(message.row, 1); assert.equal(message.version, 1);
  assert.equal(message.value, '雪\n<img onerror="bad">');
  assert.equal(h.query('.cell[aria-selected=true]'), h.w.document.activeElement);
});

test('Stale document state closes editing without sending an obsolete edit', t => {
  const h = harness(t); h.receive();
  h.query('.cell').dispatchEvent(new h.w.MouseEvent('dblclick'));
  h.receive({ version: 2 });
  assert.equal(h.query('dialog').open, false);
  h.query('dialog button').click();
  assert.equal(h.sent.length, 1);
});

test('Read-only workbook, worksheet selection and untrusted text', t => {
  const h = harness(t);
  h.receive({ readonly: true, rows: [['<img src=x onerror=bad>']], sheets: ['First', 'Second'], sheet: 0 });
  assert.equal(h.query('.cell img'), null);
  assert.equal(h.query('.cell').textContent, '<img src=x onerror=bad>');
  assert.equal(h.query('.toolbar button').hidden, true);
  h.query('.cell').dispatchEvent(new h.w.MouseEvent('dblclick'));
  assert.equal(h.query('dialog').open, false);
  h.query('select').value = '1'; h.query('select').dispatchEvent(new h.w.Event('change'));
  assert.equal(h.sent.at(-1).type, 'sheet'); assert.equal(h.sent.at(-1).sheet, 1);
});

test('100k rows and 40 columns keep the rendered DOM bounded when scrolling', async t => {
  const h = harness(t);
  const rows = Array.from({ length: 100000 }, (_, i) => Array.from({ length: 40 }, (_, c) => `${i}:${c}`));
  h.receive({ rows });
  assert.ok(h.w.document.querySelectorAll('.cell').length < 200);
  h.viewport.scrollTop = 3100000; h.viewport.scrollLeft = 4000;
  h.viewport.dispatchEvent(new h.w.Event('scroll'));
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(h.w.document.querySelectorAll('.cell').length < 200);
  assert.ok(Number(h.query('.cell').dataset.row) > 96000);
  assert.ok(Number(h.query('.cell').dataset.column) > 20);
});

test('Keyboard arrows move focus, but modifiers and grid boundaries remain native', t => {
  const h = harness(t); h.receive(); h.query('.cell').click();
  const boundary = new h.w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
  h.w.document.activeElement.dispatchEvent(boundary); assert.equal(boundary.defaultPrevented, false);
  const modified = new h.w.KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true, cancelable: true });
  h.w.document.activeElement.dispatchEvent(modified); assert.equal(modified.defaultPrevented, false);
  const next = new h.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
  h.w.document.activeElement.dispatchEvent(next); assert.equal(next.defaultPrevented, true);
  assert.equal(h.w.document.activeElement.dataset.column, '1');
});

test('Filtering hides selection and does not modify source rows', async t => {
  const h = harness(t); h.receive(); h.query('.cell').click();
  h.query('input[type=search]').value = 'Second'; h.query('input[type=search]').dispatchEvent(new h.w.Event('input'));
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(h.query('.cell').textContent, 'Second');
  assert.equal(h.query('.cell[aria-selected=true]'), null);
  assert.equal(h.sent.length, 1);
});

function findButton(h, text) {
  return Array.from(h.w.document.querySelectorAll('.toolbar button')).find(b => b.textContent === text);
}

test('Analysis buttons are hidden until paidAvailable is true', t => {
  const h = harness(t); h.receive();
  assert.equal(findButton(h, 'Compare CSV').hidden, true);
  h.receive({ paidAvailable: true });
  assert.equal(findButton(h, 'Compare CSV').hidden, false);
  assert.equal(findButton(h, 'Compare CSV').disabled, false);
});

test('Compare and summary post bridge messages with version and header flag', t => {
  const h = harness(t); h.receive({ paidAvailable: true });
  h.query('input[type=checkbox]').checked = true;
  findButton(h, 'Compare CSV').click();
  let message = h.sent.at(-1);
  assert.equal(message.type, 'compare'); assert.equal(message.version, 1); assert.equal(message.header, true);
  h.receive({ paidAvailable: true, version: 2 });
  h.w.dispatchEvent(new h.w.MessageEvent('message', { data: { type: 'analysis', version: 2, title: 'Keyed CSV comparison', report: { blocked: false, counts: { same: 1, changed: 0, added: 0, removed: 0 }, changes: [], truncated: false } }, source: null }));
  h.query('.cell').click();
  findButton(h, 'Column summary').click();
  message = h.sent.at(-1);
  assert.equal(message.type, 'summary'); assert.equal(message.column, 0); assert.equal(message.header, true);
});

test('Export XLSX posts exportXlsx message', t => {
  const h = harness(t); h.receive({ paidAvailable: true });
  findButton(h, 'Export XLSX').click();
  const message = h.sent.at(-1);
  assert.equal(message.type, 'exportXlsx'); assert.equal(message.version, 1);
});

test('Duplicate blocked comparison renders issue counts via textContent, not HTML', t => {
  const h = harness(t); h.receive({ paidAvailable: true });
  findButton(h, 'Compare CSV').click();
  h.w.dispatchEvent(new h.w.MessageEvent('message', {
    data: { type: 'analysis', version: 1, title: 'Keyed CSV comparison', report: {
      blocked: true, counts: null,
      issues: { left: { blankKeyRows: [1], duplicateKeys: [{ key: '<img onerror=bad>', rowIndices: [2, 3] }] }, right: { blankKeyRows: [], duplicateKeys: [] } },
      changes: [], truncated: false,
    } },
    source: null,
  }));
  assert.equal(h.query('dialog.report').open, true);
  assert.equal(h.query('dialog.report img'), null);
  const items = Array.from(h.w.document.querySelectorAll('dialog.report li')).map(li => li.textContent);
  assert.ok(items.some(text => text.includes('<img onerror=bad>')));
});

test('Stale analysis reply for a changed version clears pending without showing a report', t => {
  const h = harness(t); h.receive({ paidAvailable: true });
  findButton(h, 'Compare CSV').click();
  h.receive({ paidAvailable: true, version: 2 });
  h.w.dispatchEvent(new h.w.MessageEvent('message', { data: { type: 'analysis', version: 1, title: 'Keyed CSV comparison', report: { blocked: false, counts: { same: 1, changed: 0, added: 0, removed: 0 }, changes: [], truncated: false } }, source: null }));
  assert.equal(h.query('dialog.report').open, false);
  assert.equal(h.query('[role=status]').textContent, 'Document changed. Run analysis again.');
  assert.equal(findButton(h, 'Compare CSV').disabled, false);
});

test('analysisError (e.g. cancellation) clears pending and re-enables buttons without opening the dialog', t => {
  const h = harness(t); h.receive({ paidAvailable: true });
  findButton(h, 'Compare CSV').click();
  assert.equal(findButton(h, 'Compare CSV').disabled, true);
  h.w.dispatchEvent(new h.w.MessageEvent('message', { data: { type: 'analysisError', message: 'Comparison cancelled.' }, source: null }));
  assert.equal(h.query('dialog.report').open, false);
  assert.equal(h.query('[role=status]').textContent, 'Comparison cancelled.');
  assert.equal(findButton(h, 'Compare CSV').disabled, false);
});

test('Save report emits saveReport with version and no raw data', t => {
  const h = harness(t); h.receive({ paidAvailable: true });
  findButton(h, 'Compare CSV').click();
  h.w.dispatchEvent(new h.w.MessageEvent('message', { data: { type: 'analysis', version: 1, title: 'Keyed CSV comparison', report: { blocked: false, counts: { same: 1, changed: 0, added: 0, removed: 0 }, changes: [], truncated: false } }, source: null }));
  h.query('dialog.report button:nth-of-type(1)').click();
  const message = h.sent.at(-1);
  assert.equal(message.type, 'saveReport'); assert.equal(message.version, 1);
  assert.deepEqual(Object.keys(message).sort(), ['type', 'version']);
});

test('Escape closes the analysis dialog and returns focus to the triggering button', t => {
  const h = harness(t); h.receive({ paidAvailable: true });
  const button = findButton(h, 'Compare CSV');
  button.focus(); button.click();
  h.w.dispatchEvent(new h.w.MessageEvent('message', { data: { type: 'analysis', version: 1, title: 'Keyed CSV comparison', report: { blocked: false, counts: { same: 1, changed: 0, added: 0, removed: 0 }, changes: [], truncated: false } }, source: null }));
  assert.equal(h.query('dialog.report').open, true);
  h.query('dialog.report').dispatchEvent(new h.w.Event('cancel'));
  h.query('dialog.report').close();
  assert.equal(h.query('dialog.report').open, false);
  assert.equal(h.w.document.activeElement, button);
});

test('Column summary renders an accessible dl with present/blank/distinct stats via textContent', t => {
  const h = harness(t); h.receive({ paidAvailable: true });
  h.query('.cell').click();
  findButton(h, 'Column summary').click();
  h.w.dispatchEvent(new h.w.MessageEvent('message', {
    data: { type: 'analysis', version: 1, title: 'Column summary', report: { rows: 2, present: 2, blank: 0, distinct: 2, numeric: 2, sum: 23, min: 3, max: 20, mean: 11.5 } },
    source: null,
  }));
  const dl = h.query('dialog.report dl');
  assert.ok(dl);
  assert.ok(dl.textContent.includes('11.5'));
});

test('Free analysis is available without paid export; summary requires selection', t => {
  const h = harness(t); h.receive({analysisAvailable:true,paidAvailable:false});
  assert.equal(findButton(h,'Compare CSV').hidden,false);
  assert.equal(findButton(h,'Export XLSX').hidden,true);
  findButton(h,'Column summary').click();
  assert.equal(h.sent.at(-1).type,'ready');
  assert.equal(h.query('[role=status]').textContent.includes('Select a cell'),true);
});