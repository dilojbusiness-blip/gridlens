const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { parse, serialize, applyOperation } = require('../dist/csv');
const { exportValues } = require('../dist/pro/export');
const { Workbook } = require('exceljs');

(async () => {
  const sample = '\ufeff"id",amount,notes\r\n001,02.00,"雪\nline two"\r\n"0002","1e20","=SUM(A1:A2)"\n003,000.10,"say ""yes"""';
  const parsed = parse(sample, ',');
  assert.equal(serialize(parsed), sample);
  const edit = applyOperation(sample, {type:'edit',row:1,column:2,value:'changed;value'}, ',');
  const next = sample.slice(0,edit.start) + edit.text + sample.slice(edit.end);
  assert.equal(next.slice(0,edit.start), sample.slice(0,edit.start));
  assert.equal(next.slice(edit.start+edit.text.length),sample.slice(edit.end));
  const rows = parsed.rows.map(row=>row.cells.map(cell=>cell.text));
  const output = await exportValues(rows);
  const workbook = new Workbook(); await workbook.xlsx.load(output);
  let matched=0;
  rows.forEach((row,r)=>row.forEach((value,c)=>{
    const cell=workbook.getWorksheet('GridLens').getCell(r+1,c+1);
    assert.equal(cell.value,value); assert.equal(cell.formula,undefined); matched++;
  }));
  const large = Array.from({length:100000},(_,i)=>`${i},"row ${i}",001.00`).join('\r\n');
  const started=performance.now(); const largeParsed=parse(large,',');
  const parseMs=Math.round(performance.now()-started);
  assert.equal(serialize(largeParsed),large);
  console.log(JSON.stringify({
    date:new Date().toISOString(),scope:'Synthetic GridLens-only benchmark; NOT competitor comparison or customer demand evidence',
    platform:process.platform,node:process.version,csvExactRoundtrip:true,uneditedRegionsPreserved:true,
    xlsxLiteralValuesMatched:matched,formulaLikeTextExecuted:false,
    largeRows:largeParsed.rows.length,largeInputBytes:Buffer.byteLength(large),parseMs,
    limitation:'Local timing is not an end-to-end VS Code latency or memory guarantee; spreadsheet editing and licensing are not exercised.',
  },null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;});