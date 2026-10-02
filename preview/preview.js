const rows = [['id', 'customer', 'amount', 'status'], ['001', 'Aster Labs', '02.00', 'pending'], ['002', 'Mira Studio', '100.00', 'paid'], ['003', 'Snow 雪', '000.10', 'pending']];
let version = 1;
const send = () => globalThis.__gridlensPreview({ type: 'state', version, rows, readonly: false, label: 'before.csv · synthetic demonstration', delimiter: ',', analysisAvailable: true, paidAvailable: false });
document.getElementById('app').addEventListener('gridlens-message', e => {
  const msg = e.detail;
  if (msg.type === 'ready') { send(); return; }
  if (msg.type === 'compare') {
    globalThis.__gridlensPreview({ type: 'analysis', version, title: 'Keyed CSV comparison', report: {
      blocked: false, counts: { same: 0, changed: 2, added: 1, removed: 1 }, truncated: false,
      changes: [
        {type:'changed',key:'001',leftRowIndex:1,rightRowIndex:2,deltas:[{column:'amount',leftValue:'02.00',rightValue:'2.00'}]},
        {type:'removed',key:'002',leftRowIndex:2},
        {type:'changed',key:'003',leftRowIndex:3,rightRowIndex:1,deltas:[{column:'status',leftValue:'pending',rightValue:'paid'}]},
        {type:'added',key:'004',rightRowIndex:3},
      ],
    } }); return;
  }
  if (msg.type === 'summary') {
    globalThis.__gridlensPreview({ type:'analysis',version,title:'Column summary',report:{rows:3,present:3,blank:0,distinct:3,numeric:3,sum:102.1,min:0.1,max:100,mean:102.1/3} }); return;
  }
  if (msg.type === 'saveReport') { globalThis.__gridlensPreview({type:'analysisError',message:'Demonstration only; report saving is tested in the real VS Code extension.'}); return; }
  if (msg.type === 'edit') rows[msg.row][msg.column] = msg.value;
  if (msg.type === 'addRow') rows.push(['', '', '', '']);
  if (msg.type === 'deleteRow') rows.splice(msg.row, 1);
  version++; send();
});
send();