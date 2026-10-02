const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parse, serialize, applyOperation, detectDelimiter } = require('../dist/csv');
const change = (text, op, d) => { const e = applyOperation(text, op, d); return text.slice(0, e.start) + e.text + text.slice(e.end); };

for (const text of ['', '\ufeff', '\n', '""', 'a,b', 'a,b,', 'a,b\r\n1,2\r\n', 'a\r\nb\nc\rd', '\ufeff"α","雪\nrow"\r\n"say ""yes""",001\n', ' a , b \n', 'a\tb\n1\t2', 'a;b\n1;2', 'a|b\n1|2']) {
  test(`Exact round trip ${JSON.stringify(text)}`, () => assert.equal(serialize(parse(text)), text));
}
test('Logical quoted values and final empty cell', () => {
  assert.deepEqual(parse('"a,b","x\ny","a""b",', ',').rows[0].cells.map(c => c.text), ['a,b', 'x\ny', 'a"b', '']);
});
for (const bad of ['"unterminated', 'a"b,c', '"x"junk,y']) test(`Reject malformed ${bad}`, () => assert.throws(() => parse(bad, ',')));
test('Only the edited field changes, mixed EOLs and BOM retained', () => {
  const original = '\ufeff"id",amount\r\n001,02.00\n2,3';
  assert.equal(change(original, { type: 'edit', row: 1, column: 1, value: 'x,y' }), '\ufeff"id",amount\r\n001,"x,y"\n2,3');
  assert.equal(change(original, { type: 'edit', row: 1, column: 0, value: '001' }), original);
});
test('Edited blank last field does not disappear', () => assert.equal(parse(change('x', { type: 'edit', row: 0, column: 0, value: '' })).rows.length, 1));
test('Delimiter sniff ignores commas inside multiline fields', () => assert.equal(detectDelimiter('a;b\n1;"x,y\ny,z"\n2;done'), ';'));
test('TSV explicit delimiter handles punctuation', () => assert.equal(parse('a,b\tc;d', '\t').rows[0].cells.length, 2));
test('Editing alternate delimiters cannot change CSV columns after reopening', () => {
  for (const value of ['a;b;c;d', 'a|b|c|d', 'a\tb\tc\td']) {
    const changed = change('first,second', { type: 'edit', row: 0, column: 0, value });
    const reopened = parse(changed);
    assert.equal(reopened.delimiter, ',');
    assert.deepEqual(reopened.rows[0].cells.map(c => c.text), [value, 'second']);
  }
});
test('Append keeps trailing newline convention', () => {
  assert.equal(change('a,b\r\n', { type: 'addRow' }), 'a,b\r\n"",""\r\n');
  assert.equal(change('a,b', { type: 'addRow' }), 'a,b\n"",""');
  assert.equal(change('', { type: 'addRow' }), '""');
});
test('Delete first, middle and final records', () => {
  assert.equal(change('a\nb\nc', { type: 'deleteRow', row: 1 }), 'a\nc');
  assert.equal(change('a\nb\nc', { type: 'deleteRow', row: 2 }), 'a\nb');
  assert.equal(change('a\nb\n', { type: 'deleteRow', row: 0 }), 'b\n');
  assert.equal(change('\ufeffa', { type: 'deleteRow', row: 0 }), '\ufeff');
});
test('Invalid messages fail closed', () => {
  for (const op of [{ type: 'oops' }, { type: 'edit', row: -1, column: 0, value: 'x' }, { type: 'edit', row: 0, column: 20, value: 'x' }, { type: 'edit', row: 0, column: 0, value: {} }, { type: 'deleteRow', row: 100 }]) assert.throws(() => applyOperation('a,b', op));
  assert.throws(() => parse('x', ':'));
  assert.throws(() => parse(Array(513).fill('a').join(','), ','));
});
test('100,000-row parse smoke test', t => {
  const text = Array.from({ length: 100000 }, (_, i) => `${i},row ${i}`).join('\n');
  const start = performance.now(); const data = parse(text);
  assert.equal(data.rows.length, 100000); assert.equal(serialize(data), text);
  t.diagnostic(`100k rows parsed in ${Math.round(performance.now() - start)} ms`);
});