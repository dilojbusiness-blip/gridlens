const {test} = require('node:test');
const assert = require('node:assert/strict');
const {compareDemo} = require('../dist/demoWorker');
test('Browser demo uses literal keys, reordered rows and capped samples',()=>{
  const result = compareDemo({left:'id,v\n001,02.00\n002,1',right:'id,v\n002,1\n001,2.00',header:true,leftKey:1,rightKey:1});
  assert.deepEqual(result.report.counts,{same:1,changed:1,added:0,removed:0});
  assert.equal(result.report.changes[0].deltas[0].leftValue,'02.00');
});
test('Browser demo blocks duplicate keys and ragged/header issues',()=>{
  assert.equal(compareDemo({left:'id,v\n1,x\n1,y',right:'id,v\n1,z',header:true,leftKey:1,rightKey:1}).report.blocked,true);
  assert.equal(compareDemo({left:'id,v\n1',right:'id,v\n1,x',header:true,leftKey:1,rightKey:1}).kind,'structure');
});
test('Browser demo enforces reduced input and dimension limits',()=>{
  for(const text of ['x'.repeat(1048577),Array(10001).fill('x,y').join('\n'),Array(101).fill('x').join(',')])assert.throws(()=>compareDemo({left:text,right:'x,y',header:false,leftKey:1,rightKey:1}));
  assert.throws(()=>compareDemo({left:'id,v\n1,x',right:'id,v\n1,x',header:true,leftKey:0,rightKey:1}));
});
test('Browser demo bounds duplicate row samples and identifiers',()=>{
  const key='k'.repeat(250),text=Array(25).fill(`${key},x`).join('\n');
  const result=compareDemo({left:text,right:'other,x',header:false,leftKey:1,rightKey:1});
  assert.equal(result.report.issues.left.duplicateTotal,1);
  assert.equal(result.report.issues.left.duplicateKeys[0].rowIndices.length,20);
  assert.equal(result.report.issues.left.duplicateKeys[0].key.length,200);
});