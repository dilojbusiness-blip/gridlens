const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

function stubbedTransport(scenario) {
  let options,body;
  const https={request:(opts,callback)=>{
    options=opts;
    const req=new EventEmitter();
    req.destroy=error=>queueMicrotask(()=>req.emit('error',error));
    req.end=text=>{body=text;queueMicrotask(()=>{
      const response=new EventEmitter(); response.statusCode=scenario.status;
      callback(response);
      for(const chunk of scenario.chunks) response.emit('data',Buffer.from(chunk));
      response.emit('end');
    });};
    return req;
  }};
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/pro/licenseClient'),'utf8'),{
    module,exports:module.exports,require:name=>name==='node:https'?https:require(name),
    Buffer,URLSearchParams,setTimeout,clearTimeout,
  });
  return { request:module.exports.requestLicense,options:()=>options,body:()=>body };
}

test('License transport uses fixed HTTPS endpoint, form encoding and no merchant API credential', async () => {
  const h=stubbedTransport({status:200,chunks:['{"valid":true}']});
  const result=await h.request('validate',{license_key:'synthetic + key',instance_id:'test'});
  assert.equal(result.valid,true);
  assert.equal(h.options().hostname,'api.lemonsqueezy.com');
  assert.equal(h.options().path,'/v1/licenses/validate');
  assert.equal(h.options().headers.Accept,'application/json');
  assert.equal(h.options().headers['Content-Type'],'application/x-www-form-urlencoded');
  assert.equal(h.options().headers.Authorization,undefined);
  assert.equal(new URLSearchParams(h.body()).get('license_key'),'synthetic + key');
});

test('License transport rejects redirect, server error, rate limit and malformed JSON safely', async () => {
  for(const scenario of [{status:302,chunks:['{}']},{status:503,chunks:['{}']},{status:429,chunks:['{}']},{status:200,chunks:['not JSON']}]) {
    const h=stubbedTransport(scenario);
    await assert.rejects(h.request('validate',{license_key:'synthetic-sensitive-key'}),error=>!error.message.includes('synthetic-sensitive-key'));
  }
});

test('License transport rejects oversized response and passes structured 4xx denial to assessment', async () => {
  const huge=stubbedTransport({status:200,chunks:[' '.repeat(65537)]});
  await assert.rejects(huge.request('validate',{license_key:'synthetic'}));
  const denied=stubbedTransport({status:422,chunks:['{"valid":false,"error":"bad key"}']});
  assert.equal((await denied.request('validate',{license_key:'synthetic'})).valid,false);
});