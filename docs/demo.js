(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const form = $('compare-form'), left = $('left-csv'), right = $('right-csv'), results = $('results'), status = $('status');
  let worker, timer, active = false;
  const sampleLeft = 'id,customer,amount,status\n001,Aster Labs,02.00,pending\n002,Mira Studio,100.00,paid\n003,Snow 雪,000.10,pending';
  const sampleRight = 'id,customer,amount,status\n003,Snow 雪,000.10,paid\n001,Aster Labs,2.00,pending\n004,Northstar,25.00,new';
  function stop() {
    worker?.terminate(); worker = undefined; clearTimeout(timer); active = false;
    $('compare').disabled = false; results.removeAttribute('aria-busy');
  }
  function clearResult() { stop(); results.replaceChildren(); status.textContent = ''; }
  const add = (tag, text, parent = results) => { const el = document.createElement(tag); el.textContent = text; parent.append(el); return el; };
  function render(result) {
    results.replaceChildren();
    if (result.kind === 'structure') {
      add('h3', 'Comparison stopped: check table structure');
      for (const table of result.tables) {
        add('p', `${table.side}: ${table.rows} rows, ${table.columns} expected columns, ${table.totalIssues} issues.`);
        const list = add('ul', '');
        for (const issue of table.issues) add('li', `${issue.code} at row ${issue.rowIndex + 1}${issue.columnIndex === undefined ? '' : ', column ' + (issue.columnIndex + 1)}${issue.actualColumns === undefined ? '' : ': expected ' + issue.expectedColumns + ', found ' + issue.actualColumns}`, list);
      }
      status.textContent = 'Structural issues found. No source data was modified.';
    } else {
      const report = result.report;
      if (report.blocked) {
        add('h3', 'Matching blocked: keys must be unique and nonblank');
        for (const side of ['left', 'right']) {
          const issues = report.issues[side];
          add('p', `${side}: ${issues.blankTotal} blank-key rows and ${issues.duplicateTotal} duplicate-key groups.`);
          const list = add('ul', '');
          for (const row of issues.blankKeyRows) add('li', `Blank key: row ${row + 1}`, list);
          for (const issue of issues.duplicateKeys) add('li', `Duplicate ${issue.key}: row samples ${issue.rowIndices.map(n => n + 1).join(', ')}`, list);
        }
        status.textContent = 'Key issues found. Matching was not attempted.';
      } else {
        const c = report.counts;
        const heading = add('h3', `${c.same} same · ${c.changed} changed · ${c.added} added · ${c.removed} removed`);
        heading.className = 'visually-hidden';
        const metrics = add('div', ''); metrics.className = 'result-metrics';
        for (const type of ['same', 'changed', 'added', 'removed']) {
          const metric = add('div', '', metrics); metric.className = 'metric-' + type;
          add('strong', String(c[type]), metric); add('span', type, metric);
        }
        const list = add('ul', '');
        list.className = 'change-list';
        for (const change of report.changes) {
          const item = add('li', '', list);
          const label = add('div', '', item); label.className = 'change-label';
          const badge = add('span', change.type, label); badge.className = 'change-badge badge-' + change.type;
          add('code', `key ${change.key}`, label);
          if (change.type === 'changed') {
            const fields = add('ul', '', item);
            for (const d of change.deltas) {
              const field = add('li', '', fields);
              add('span', d.column, field);
              const values = add('div', '', field); values.className = 'delta-values';
              add('del', d.leftValue, values); add('span', '→', values); add('ins', d.rightValue, values);
            }
          }
        }
        if (!report.changes.length) add('p', 'No field differences found. All matched records have identical literal values.');
        if (report.truncated) add('p', 'Showing at most 100 difference samples, including added and removed records. Total counts include all records.');
        status.textContent = 'Comparison complete. Source data remains unchanged.';
      }
    }
    add('p', 'Displayed identifiers/values are limited to 200 characters; issue row samples are capped. This is not a full-file export.');
    results.focus();
  }
  form.addEventListener('submit', event => {
    event.preventDefault(); clearResult();
    if (typeof Worker !== 'function') { status.textContent = 'This demo needs Web Workers. Use a supported browser or the VS Code extension.'; return; }
    const input = { left: left.value, right: right.value, header: $('headers').checked, leftKey: Number($('left-key').value), rightKey: Number($('right-key').value) };
    if (!input.left || !input.right) { status.textContent = 'Paste both CSV inputs or load the sample first.'; return; }
    if ([input.left, input.right].some(text => text.length > 1_048_576 || new TextEncoder().encode(text).length > 1_048_576)) { status.textContent = 'Demo limit: 1 MiB per input.'; return; }
    active = true; $('compare').disabled = true; results.setAttribute('aria-busy', 'true'); status.textContent = 'Comparing locally…';
    try { worker = new Worker('worker.js'); }
    catch { stop(); status.textContent = 'Could not start the local worker. Open the demo over HTTPS, not as a downloaded file.'; return; }
    worker.onmessage = event => { const message = event.data; stop(); if (message.ok) render(message.result); else status.textContent = String(message.message); };
    worker.onerror = () => { stop(); status.textContent = 'The local worker could not load. Please reload the page.'; };
    timer = setTimeout(() => { stop(); status.textContent = 'Demo timed out. Try a smaller input or use the VS Code extension.'; }, 10000);
    worker.postMessage(input);
  });
  $('load-sample').addEventListener('click', () => { clearResult(); left.value = sampleLeft; right.value = sampleRight; $('headers').checked = true; $('left-key').value = $('right-key').value = '1'; status.textContent = 'Synthetic samples loaded. Click Compare.'; });
  $('duplicate-sample').addEventListener('click', () => { clearResult(); left.value = sampleLeft + '\n001,Duplicate,05.00,pending'; right.value = sampleRight; $('headers').checked = true; $('left-key').value = $('right-key').value = '1'; status.textContent = 'Duplicate-key sample loaded. Matching should be blocked.'; });
  $('clear-data').addEventListener('click', () => { clearResult(); left.value = right.value = ''; status.textContent = 'Inputs and results cleared from this page.'; });
  for (const el of [left, right, $('headers'), $('left-key'), $('right-key')]) el.addEventListener('input', () => { if (active) { clearResult(); status.textContent = 'Input changed; previous comparison cancelled.'; } else { results.replaceChildren(); status.textContent = 'Input changed. Run comparison again.'; } });
  window.addEventListener('pagehide', () => { stop(); left.value = right.value = ''; results.replaceChildren(); });
})();