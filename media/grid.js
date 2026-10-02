(() => {
  'use strict';
  const bridge = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
  const saved = bridge?.getState() || {};
  const app = document.getElementById('app');
  const make = (tag, text, className) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  };
  const bar = make('header', undefined, 'toolbar');
  bar.append(make('strong', '▦ GridLens', 'brand'));
  const label = make('span', 'Loading…', 'filename');
  const filter = make('input'); filter.type = 'search'; filter.placeholder = 'Filter all cells…'; filter.setAttribute('aria-label', 'Filter rows'); filter.value = saved.filter || '';
  const headers = make('input'); headers.type = 'checkbox'; headers.checked = Boolean(saved.headers);
  const headerLabel = make('label', undefined, 'toggle'); headerLabel.append(headers, make('span', 'First row is header'));
  const sheet = make('select'); sheet.setAttribute('aria-label', 'Worksheet'); sheet.hidden = true;
  const add = make('button', '+ Row');
  const remove = make('button', 'Delete row');
  const compareBtn = make('button', 'Compare CSV');
  const summaryBtn = make('button', 'Column summary');
  const exportBtn = make('button', 'Export XLSX');
  const reload = make('button', 'Reload');
  bar.append(label, filter, headerLabel, sheet, add, remove, compareBtn, summaryBtn, exportBtn, reload);
  const hint = make('p', 'Sort and filter change the view, not the file. Double-click a cell to edit.', 'hint');
  const viewport = make('div', undefined, 'viewport'); viewport.tabIndex = 0; viewport.setAttribute('aria-label', 'Spreadsheet');
  const canvas = make('div', undefined, 'canvas'); canvas.setAttribute('role', 'grid'); viewport.append(canvas);
  const status = make('footer', 'Waiting for document…'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const editor = make('dialog');
  const editorLabel = make('label', 'Cell value'); editorLabel.htmlFor = 'cell-value';
  const value = make('textarea'); value.id = 'cell-value'; value.rows = 6; value.setAttribute('spellcheck', 'false');
  const commit = make('button', 'Apply'); const cancel = make('button', 'Cancel');
  editor.append(editorLabel, value, make('p', 'Enter to apply · Shift+Enter for a newline · Escape to cancel'), commit, cancel);
  const analysisDialog = make('dialog', undefined, 'report');
  analysisDialog.setAttribute('aria-labelledby', 'analysis-title');
  const analysisTitle = make('h2'); analysisTitle.id = 'analysis-title';
  const analysisBody = make('div', undefined, 'analysis-body');
  const analysisSave = make('button', 'Save report');
  const analysisClose = make('button', 'Close');
  analysisDialog.append(analysisTitle, analysisBody, analysisSave, analysisClose);
  app.append(bar, hint, viewport, status, editor, analysisDialog);

  let data = { rows: [], readonly: true, version: 0, delimiter: ',' }, order = [], columns = 1;
  let pending = true, errored = false, sortColumn = Number.isInteger(saved.sortColumn) ? saved.sortColumn : -1, ascending = saved.ascending !== false, selected = null, editing = null;
  let paidAvailable = false, analysisAvailable = false, analysisPending = false, analysisTrigger = null;
  let frame = 0, filterTimer;
  const ROW = 32, COL = 160, GUTTER = 64;
  const post = message => {
    if (bridge) bridge.postMessage(message);
    else app.dispatchEvent(new CustomEvent('gridlens-message', { detail: message }));
  };
  const saveView = () => bridge?.setState({ filter: filter.value, headers: headers.checked, sortColumn, ascending });
  const controls = () => {
    add.hidden = remove.hidden = data.readonly;
    add.disabled = pending || errored;
    remove.disabled = pending || errored || !selected;
    commit.disabled = pending || errored;
    const analysisAllowed = (analysisAvailable || paidAvailable) && !data.readonly;
    compareBtn.hidden = summaryBtn.hidden = !(analysisAvailable || paidAvailable);
    exportBtn.hidden = !paidAvailable;
    compareBtn.disabled = summaryBtn.disabled = pending || errored || analysisPending || !analysisAllowed;
    exportBtn.disabled = pending || errored || analysisPending || !paidAvailable;
  };
  const rebuild = () => {
    columns = data.rows.reduce((n, row) => Math.max(n, row.length), 1);
    const q = filter.value.toLocaleLowerCase();
    order = [];
    for (let i = headers.checked ? 1 : 0; i < data.rows.length; i++) {
      if (!q || data.rows[i].some(c => c.toLocaleLowerCase().includes(q))) order.push(i);
    }
    if (sortColumn >= 0) {
      order.sort((a, b) => {
        const x = data.rows[a][sortColumn] ?? '', y = data.rows[b][sortColumn] ?? '';
        const numeric = x.trim() !== '' && y.trim() !== '' && Number.isFinite(Number(x)) && Number.isFinite(Number(y));
        const comparison = numeric ? Number(x) - Number(y) : x.localeCompare(y);
        return (ascending ? comparison : -comparison) || a - b;
      });
    }
    if (selected && (!order.includes(selected.row) || selected.column >= columns)) selected = null;
    canvas.style.width = `${GUTTER + columns * COL}px`;
    canvas.style.height = `${Math.max(2, order.length + 1) * ROW}px`;
    canvas.setAttribute('aria-rowcount', String(order.length + 1));
    canvas.setAttribute('aria-colcount', String(columns));
    status.textContent = `${order.length.toLocaleString()} / ${data.rows.length.toLocaleString()} rows · ${columns} columns · ${data.readonly ? 'Read-only XLSX' : data.delimiter === '\t' ? 'TSV' : 'CSV (' + data.delimiter + ')'} · Local only`;
    saveView(); controls(); render();
  };
  const place = (el, x, y, width) => {
    el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.width = `${width}px`;
    canvas.append(el);
  };
  const columnName = index => {
    let name = '';
    for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
    return name;
  };
  function render() {
    const focusedCell = document.activeElement?.classList.contains('cell');
    canvas.replaceChildren();
    const first = Math.max(0, Math.floor(viewport.scrollTop / ROW) - 2);
    const last = Math.min(order.length, first + Math.ceil(viewport.clientHeight / ROW) + 6);
    const startColumn = Math.max(0, Math.floor((viewport.scrollLeft - GUTTER) / COL) - 1);
    const endColumn = Math.min(columns, startColumn + Math.ceil(viewport.clientWidth / COL) + 3);
    const headerY = viewport.scrollTop;
    for (let c = startColumn; c < endColumn; c++) {
      const title = headers.checked ? data.rows[0]?.[c] || columnName(c) : columnName(c);
      const button = make('button', title + (sortColumn === c ? ascending ? ' ↑' : ' ↓' : ''), 'column');
      button.title = `Sort ${title}`;
      button.setAttribute('aria-label', `Sort column ${columnName(c)}`);
      button.addEventListener('click', () => { ascending = sortColumn === c ? !ascending : true; sortColumn = c; rebuild(); });
      place(button, GUTTER + c * COL, headerY, COL);
    }
    for (let viewRow = first; viewRow < last; viewRow++) {
      const source = order[viewRow], y = (viewRow + 1) * ROW;
      const number = make('div', String(source + 1), 'row-number');
      place(number, viewport.scrollLeft, y, GUTTER);
      for (let c = startColumn; c < endColumn; c++) {
        const text = data.rows[source][c];
        const cell = make('div', text ?? '', 'cell');
        cell.dataset.row = String(source); cell.dataset.column = String(c);
        cell.title = text ?? ''; cell.setAttribute('role', 'gridcell');
        cell.setAttribute('aria-rowindex', String(viewRow + 2)); cell.setAttribute('aria-colindex', String(c + 1));
        const active = selected?.row === source && selected.column === c;
        cell.tabIndex = active || (!selected && viewRow === first && c === startColumn) ? 0 : -1;
        cell.setAttribute('aria-selected', String(active));
        cell.addEventListener('click', () => {
          selected = { row: source, column: c };
          for (const item of canvas.querySelectorAll('.cell')) {
            const current = item === cell;
            item.tabIndex = current ? 0 : -1;
            item.setAttribute('aria-selected', String(current));
          }
          controls(); cell.focus({ preventScroll: true });
        });
        cell.addEventListener('dblclick', () => openEditor(source, c));
        cell.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); openEditor(source, c); return; }
          const directions = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
          const direction = directions[e.key];
          if (!direction || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
          const targetRow = Math.max(0, Math.min(order.length - 1, viewRow + direction[0]));
          const targetColumn = Math.max(0, Math.min(columns - 1, c + direction[1]));
          if (targetRow === viewRow && targetColumn === c) return;
          e.preventDefault();
          selected = { row: order[targetRow], column: targetColumn };
          const top = (targetRow + 1) * ROW, left = GUTTER + targetColumn * COL;
          if (top < viewport.scrollTop + ROW) viewport.scrollTop = top - ROW;
          if (top + ROW > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = top + ROW - viewport.clientHeight;
          if (left < viewport.scrollLeft + GUTTER) viewport.scrollLeft = left - GUTTER;
          if (left + COL > viewport.scrollLeft + viewport.clientWidth) viewport.scrollLeft = left + COL - viewport.clientWidth;
          render(); focusSelected(); controls();
        });
        place(cell, GUTTER + c * COL, y, COL);
      }
    }
    const corner = make('div', '#', 'corner'); place(corner, viewport.scrollLeft, headerY, GUTTER);
    if (focusedCell) focusSelected();
  }
  function focusSelected() {
    if (selected) canvas.querySelector(`[data-row="${selected.row}"][data-column="${selected.column}"]`)?.focus({ preventScroll: true });
  }
  function openEditor(row, column) {
    if (data.readonly || pending || errored || data.rows[row]?.[column] === undefined) return;
    editing = { row, column, version: data.version };
    editorLabel.textContent = `Row ${row + 1} · Column ${columnName(column)}`;
    value.value = data.rows[row][column]; editor.showModal(); value.focus();
  }
  const closeEditor = () => { editor.close(); editing = null; focusSelected(); };
  const sendEdit = operation => {
    if (pending || errored || data.readonly) return;
    pending = true; controls(); status.textContent = 'Applying edit…'; post({ ...operation, version: data.version });
  };
  commit.addEventListener('click', () => {
    if (!editing) return;
    if (editing.version !== data.version) { status.textContent = 'Document changed. Reopen the cell to edit the current value.'; closeEditor(); return; }
    const target = editing; const next = value.value; closeEditor(); sendEdit({ type: 'edit', ...target, value: next });
  });
  cancel.addEventListener('click', closeEditor);
  editor.addEventListener('cancel', () => { editing = null; });
  editor.addEventListener('close', focusSelected);
  value.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); commit.click(); } });
  add.addEventListener('click', () => sendEdit({ type: 'addRow' }));
  remove.addEventListener('click', () => { if (selected) sendEdit({ type: 'deleteRow', row: selected.row }); });
  reload.addEventListener('click', () => { post({ type: 'ready' }); });

  function startAnalysis(trigger, message) {
    if (analysisPending || pending || errored || !(analysisAvailable || paidAvailable) || data.readonly) return;
    analysisPending = true; analysisTrigger = trigger; controls();
    status.textContent = trigger === 'compare' ? 'Comparing…' : trigger === 'summary' ? 'Summarizing…' : 'Exporting…';
    post({ ...message, version: data.version });
  }
  compareBtn.addEventListener('click', () => startAnalysis('compare', { type: 'compare', header: headers.checked }));
  summaryBtn.addEventListener('click', () => {
    if (!selected) { status.textContent = 'Select a cell in the column to summarize first.'; return; }
    startAnalysis('summary', { type: 'summary', column: selected.column, header: headers.checked });
  });
  exportBtn.addEventListener('click', () => startAnalysis('exportXlsx', { type: 'exportXlsx', header: headers.checked }));

  const closeAnalysis = () => { analysisDialog.close(); focusAfterAnalysis(); };
  let analysisReturnFocus = null;
  function focusAfterAnalysis() {
    analysisReturnFocus?.focus({ preventScroll: true }); analysisReturnFocus = null;
  }
  analysisClose.addEventListener('click', closeAnalysis);
  analysisDialog.addEventListener('cancel', () => { /* native Escape path also triggers close event */ });
  analysisDialog.addEventListener('close', focusAfterAnalysis);
  analysisSave.addEventListener('click', () => post({ type: 'saveReport', version: data.version }));

  function dl(container, term, text) {
    container.append(make('dt', term), make('dd', text));
  }
  function renderSummary(report) {
    analysisTitle.textContent = 'Column summary';
    const list = make('dl');
    dl(list, 'Rows', String(report.rows));
    dl(list, 'Present', String(report.present));
    dl(list, 'Blank', String(report.blank));
    dl(list, 'Distinct', String(report.distinct));
    dl(list, 'Numeric', String(report.numeric));
    dl(list, 'Sum', String(report.sum));
    dl(list, 'Min', String(report.min));
    dl(list, 'Max', String(report.max));
    dl(list, 'Mean', String(report.mean));
    analysisBody.replaceChildren(list);
  }
  function renderCompare(report) {
    analysisTitle.textContent = 'Keyed CSV comparison';
    const body = make('div');
    if (report.blocked) {
      body.append(make('p', 'Blocked: key integrity issues found before comparing rows.'));
      for (const side of ['left', 'right']) {
        const issues = report.issues?.[side];
        if (!issues) continue;
        const heading = make('h3', side === 'left' ? 'Left file' : 'Right file');
        const list = make('ul');
        let shown = 0;
        for (const rowIndex of issues.blankKeyRows || []) {
          if (shown >= 20) break;
          list.append(make('li', `Blank key at row ${rowIndex + 1}`)); shown++;
        }
        for (const dup of issues.duplicateKeys || []) {
          if (shown >= 20) break;
          list.append(make('li', `Duplicate key "${dup.key}" at rows ${dup.rowIndices.map(i => i + 1).join(', ')}`)); shown++;
        }
        const total = (issues.blankKeyRows?.length || 0) + (issues.duplicateKeys?.length || 0);
        body.append(heading, list, make('p', `Total issues: ${total}`));
      }
    } else if (report.counts) {
      const list = make('dl');
      dl(list, 'Same', String(report.counts.same));
      dl(list, 'Changed', String(report.counts.changed));
      dl(list, 'Added', String(report.counts.added));
      dl(list, 'Removed', String(report.counts.removed));
      body.append(list);
      const changes = make('ul');
      let shown = 0;
      for (const change of report.changes || []) {
        if (shown >= 100) break;
        if (change.type === 'changed') {
          const item = make('li');
          item.append(make('strong', `Key ${change.key}`));
          item.append(make('span', ` (left row ${change.leftRowIndex + 1}, right row ${change.rightRowIndex + 1})`));
          const deltaList = make('ul');
          for (const d of change.deltas) {
            deltaList.append(make('li', `${d.column}: "${d.leftValue}" → "${d.rightValue}"`));
          }
          item.append(deltaList);
          changes.append(item);
        } else if (change.type === 'removed') {
          changes.append(make('li', `Removed key ${change.key} (left row ${change.leftRowIndex + 1})`));
        } else if (change.type === 'added') {
          changes.append(make('li', `Added key ${change.key} (right row ${change.rightRowIndex + 1})`));
        }
        shown++;
      }
      body.append(changes);
      if (report.truncated) body.append(make('p', 'Changes are sampled. Saved JSON also contains only the reported sample (up to 1,000 changes), with exact total counts.'));
    }
    analysisBody.replaceChildren(body);
  }

  sheet.addEventListener('change', () => { selected = null; viewport.scrollTop = 0; pending = true; controls(); status.textContent = 'Loading worksheet…'; post({ type: 'sheet', sheet: Number(sheet.value) }); });
  filter.addEventListener('input', () => { clearTimeout(filterTimer); filterTimer = setTimeout(() => { viewport.scrollTop = 0; rebuild(); }, 200); });
  headers.addEventListener('change', () => { selected = null; viewport.scrollTop = 0; rebuild(); });
  viewport.addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); }); });
  new ResizeObserver(() => render()).observe(viewport);
  const receive = message => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'error') { errored = true; pending = false; status.textContent = String(message.message); controls(); return; }
    if (message.type === 'analysis') {
      if (message.version !== data.version) { analysisPending = false; analysisTrigger = null; status.textContent = 'Document changed. Run analysis again.'; controls(); return; }
      analysisPending = false; controls();
      if (message.title === 'Column summary') renderSummary(message.report);
      else renderCompare(message.report);
      analysisReturnFocus = document.activeElement;
      if (!analysisDialog.open) analysisDialog.showModal();
      status.textContent = 'Analysis ready.';
      return;
    }
    if (message.type === 'analysisError') {
      analysisPending = false; analysisTrigger = null; status.textContent = String(message.message); controls();
      return;
    }
    if (message.type !== 'state' || !Array.isArray(message.rows)) return;
    data = message; pending = false; errored = false;
    paidAvailable = message.paidAvailable === true;
    analysisAvailable = message.analysisAvailable === true;
    label.textContent = message.label || 'Untitled';
    hint.textContent = message.warning || 'Sort/filter change only the view. Double-click or Enter to edit. Save and undo work in VS Code.';
    sheet.replaceChildren(); sheet.hidden = !message.sheets;
    if (message.sheets) message.sheets.forEach((name, i) => { const option = make('option', name); option.value = String(i); sheet.append(option); });
    sheet.value = String(message.sheet ?? 0);
    if (selected && selected.row >= data.rows.length) selected = null;
    if (editor.open && editing?.version !== message.version) closeEditor();
    rebuild();
  };
  // VS Code injects host messages with a null source, unlike window.postMessage.
  window.addEventListener('message', e => { if (e.source === null || e.source === window) receive(e.data); });
  if (!bridge) globalThis.__gridlensPreview = receive;
  controls(); post({ type: 'ready' });
})();