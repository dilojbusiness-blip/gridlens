export interface Cell { text: string; raw: string; start: number; end: number }
export interface Row { cells: Cell[]; start: number; end: number; eol: string }
export interface ParseResult { rows: Row[]; delimiter: string; bom: boolean; eol: string }
export const MAX_TEXT = 50 * 1024 * 1024;
const DELIMITERS = [',', ';', '\t', '|'];

export function detectDelimiter(text: string, explicit?: string): string {
  if (explicit !== undefined) {
    if (!DELIMITERS.includes(explicit)) throw new Error('Unsupported delimiter.');
    return explicit;
  }
  const counts: number[][] = [];
  let current = [0, 0, 0, 0], quoted = false, start = true;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < Math.min(text.length, 200_000); i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { i++; continue; }
      if (quoted) quoted = false;
      else if (start) quoted = true;
      start = false;
    } else if (!quoted && (c === '\r' || c === '\n')) {
      counts.push(current); current = [0, 0, 0, 0]; start = true;
      if (c === '\r' && text[i + 1] === '\n') i++;
      if (counts.length >= 32) break;
    } else if (!quoted) {
      const d = DELIMITERS.indexOf(c);
      if (d >= 0) { current[d]++; start = true; } else start = false;
    }
  }
  if (current.some(Boolean)) counts.push(current);
  let best = ',', score = 0;
  for (let d = 0; d < DELIMITERS.length; d++) {
    const frequency = new Map<number, number>();
    for (const r of counts) if (r[d]) frequency.set(r[d], (frequency.get(r[d]) ?? 0) + 1);
    for (const [n, f] of frequency) {
      const s = f * f / Math.max(1, counts.length) + Math.min(n, 10) / 100;
      if (s > score) { best = DELIMITERS[d]; score = s; }
    }
  }
  return best;
}

export function parse(text: string, explicit?: string): ParseResult {
  if (text.length > MAX_TEXT) throw new Error('CSV exceeds the 50 MiB text limit.');
  const bom = text.charCodeAt(0) === 0xfeff;
  const delimiter = detectDelimiter(text, explicit);
  let i = bom ? 1 : 0, cellCount = 0, defaultEol = '';
  const rows: Row[] = [];
  while (i < text.length) {
    const start = i, cells: Cell[] = [];
    let eol = '';
    for (;;) {
      const fieldStart = i;
      let value: string;
      if (text[i] === '"') {
        i++;
        let segment = i;
        const parts: string[] = [];
        for (;;) {
          if (i >= text.length) throw new Error(`Unterminated quoted field in row ${rows.length + 1}.`);
          if (text[i] === '"') {
            parts.push(text.slice(segment, i));
            if (text[i + 1] === '"') { parts.push('"'); i += 2; segment = i; }
            else { i++; break; }
          } else i++;
        }
        value = parts.join('');
        if (i < text.length && ![delimiter, '\r', '\n'].includes(text[i])) throw new Error(`Unexpected content after quoted field in row ${rows.length + 1}.`);
      } else {
        while (i < text.length && ![delimiter, '\r', '\n'].includes(text[i])) {
          if (text[i] === '"') throw new Error(`Quote inside unquoted field in row ${rows.length + 1}.`);
          i++;
        }
        value = text.slice(fieldStart, i);
      }
      cells.push({ text: value, raw: text.slice(fieldStart, i), start: fieldStart, end: i });
      if (++cellCount > 1_000_000 || cells.length > 512) throw new Error('CSV exceeds 1 million cells or 512 columns.');
      if (text[i] === delimiter) { i++; continue; }
      if (text[i] === '\r' || text[i] === '\n') {
        eol = text[i] === '\r' && text[i + 1] === '\n' ? '\r\n' : text[i];
        i += eol.length;
        if (!defaultEol) defaultEol = eol;
      }
      break;
    }
    rows.push({ cells, start, end: i, eol });
    if (rows.length > 100_001) throw new Error('CSV exceeds 100,001 rows.');
  }
  return { rows, delimiter, bom, eol: defaultEol || '\n' };
}

export function needsQuotes(text: string, delimiter: string): boolean {
  // Quote delimiter candidates so edited text cannot change detection on reopen.
  return text === '' || text.includes(delimiter) || /[,;\t|"\r\n]/.test(text);
}
export function quoteField(text: string): string { return '"' + text.replace(/"/g, '""') + '"'; }
export function serialize(result: ParseResult): string {
  return (result.bom ? '\ufeff' : '') + result.rows.map(r => r.cells.map(c => c.raw).join(result.delimiter) + r.eol).join('');
}

export interface OffsetEdit { start: number; end: number; text: string }
export function applyOperation(text: string, op: Record<string, unknown>, delimiter?: string): OffsetEdit {
  const result = parse(text, delimiter), rows = result.rows;
  const rowIndex = op.row;
  const validRow = typeof rowIndex === 'number' && Number.isInteger(rowIndex) && rowIndex >= 0 && rowIndex < rows.length;
  if (op.type === 'edit') {
    if (!validRow || typeof op.column !== 'number' || !Number.isInteger(op.column) || op.column < 0 || op.column >= rows[rowIndex as number].cells.length) throw new Error('Invalid cell index.');
    if (typeof op.value !== 'string' || op.value.length > 1_048_576) throw new Error('Invalid or oversized cell value.');
    const c = rows[rowIndex as number].cells[op.column];
    return { start: c.start, end: c.end, text: op.value === c.text ? c.raw : needsQuotes(op.value, result.delimiter) ? quoteField(op.value) : op.value };
  }
  if (op.type === 'addRow') {
    const count = Math.max(1, rows[0]?.cells.length ?? 1);
    const blank = Array(count).fill('""').join(result.delimiter);
    const last = rows.at(-1);
    return { start: text.length, end: text.length, text: last ? last.eol ? blank + result.eol : result.eol + blank : blank };
  }
  if (op.type === 'deleteRow') {
    if (!validRow) throw new Error('Invalid row index.');
    const row = rows[rowIndex as number];
    const previous = rows[(rowIndex as number) - 1];
    return { start: !row.eol && previous ? row.start - previous.eol.length : row.start, end: row.end, text: '' };
  }
  throw new Error('Unknown edit operation.');
}