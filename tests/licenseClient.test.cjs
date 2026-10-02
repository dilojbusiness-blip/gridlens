const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LicenseClient } = require('../dist/pro/licenseClient');
const product = { storeId:101, productId:202, variantId:303 };
const key = 'synthetic-license-not-real';
const id = '00000000-0000-4000-8000-000000000001';
function harness(handler) {
  const saved = new Map(), calls = [];
  let now = Date.parse('2026-10-02T00:00:00Z');
  const secrets = { get:async name => saved.get(name), store:async (name,value) => saved.set(name,value), delete:async name => saved.delete(name) };
  const response = fields => ({ valid:true, activated:true, error:null, license_key:{ key:fields.license_key,status:fields.instance_id?'active':'inactive',expires_at:null },meta:{store_id:101,product_id:202,variant_id:303},instance:fields.instance_id?{id:fields.instance_id}:null });
  const transport = async (operation,fields) => {
    calls.push({operation,fields});
    if(handler) return handler(operation,fields,response);
    const result = response(fields);
    if(operation==='activate') { result.license_key.status='active'; result.instance={id}; }
    if(operation==='deactivate') return {deactivated:true,error:null};
    return result;
  };
  return { client:new LicenseClient(product,secrets,transport,()=>now), calls,saved,secrets,transport, clock:()=>now, advance:ms=>{now+=ms;} };
}

test('Activates with preflight, stores only in secret adapter, returns no key or customer data', async () => {
  const h=harness(); const result=await h.client.activate(key);
  assert.deepEqual(result,{allowed:true});
  assert.deepEqual(h.calls.map(c=>c.operation),['validate','activate']);
  assert.equal(JSON.stringify(result).includes(key),false);
  assert.equal(JSON.parse([...h.saved.values()][0]).instanceId,id);
  await h.client.validate(); assert.equal(h.calls.length,2);
  h.advance(300001); assert.equal((await h.client.validate()).allowed,true); assert.equal(h.calls.length,3);
});
test('Wrong product cannot consume an activation slot', async () => {
  const h=harness((op,fields,response)=>{const r=response(fields);r.meta.product_id=999;return r;});
  assert.deepEqual(await h.client.activate(key),{allowed:false,reason:'rejected'});
  assert.equal(h.calls.length,1); assert.equal(h.saved.size,0);
});
test('Activation limit stops before consuming another slot', async () => {
  const h=harness((op,fields,response)=>{const r=response(fields);r.license_key.activation_limit=1;r.license_key.activation_usage=1;return r;});
  assert.deepEqual(await h.client.activate(key),{allowed:false,reason:'activation_limit'});
  assert.deepEqual(h.calls.map(c=>c.operation),['validate']); assert.equal(h.saved.size,0);
});
test('Repeated activation of the same key validates instead of consuming another slot', async () => {
  const h=harness(); await h.client.activate(key); await h.client.activate(key);
  assert.deepEqual(h.calls.map(c=>c.operation),['validate','activate','validate']);
  assert.equal((await h.client.activate('other-key')).allowed,false); assert.equal(h.calls.length,3);
});
test('Offline errors cannot grant Pro; restarting requires an online check', async () => {
  const h=harness(); await h.client.activate(key);
  const client=new LicenseClient(product,h.secrets,async()=>{throw new Error('sensitive payload must not escape');},h.clock);
  assert.deepEqual(await client.validate(),{allowed:false,reason:'unavailable'});
  assert.equal(h.saved.size,1);
});
test('Revocation after cache expires denies Pro and preserves local state for recovery', async () => {
  const h=harness(); await h.client.activate(key); h.advance(300001);
  const client=new LicenseClient(product,h.secrets,async()=>({valid:false,error:'revoked'}),h.clock);
  assert.equal((await client.validate()).allowed,false);
  assert.deepEqual(await client.deactivate(),{allowed:false,reason:'rejected'});
  assert.equal(h.saved.size,1);
});
test('Deactivation releases the remote activation and wipes local secret', async () => {
  const h=harness(); await h.client.activate(key); await h.client.deactivate();
  assert.deepEqual(h.calls.map(c=>c.operation),['validate','activate','validate','deactivate']);
  assert.equal(h.saved.size,0); assert.equal((await h.client.validate()).allowed,false);
});
test('No configuration or malformed secret makes no network call', async () => {
  const h=harness(); const client=new LicenseClient(null,h.secrets,h.transport);
  assert.deepEqual(await client.activate(key),{allowed:false,reason:'configuration'});
  h.saved.set('gridlens.pro.activation','not-json');
  assert.deepEqual(await h.client.validate(),{allowed:false,reason:'missing'});
  assert.equal(h.calls.length,0);
});
test('Restores a valid existing activation without activating or consuming a slot', async () => {
  const h=harness();
  assert.deepEqual(await h.client.restore(key,id),{allowed:true});
  assert.deepEqual(h.calls.map(c=>c.operation),['validate']);
  assert.equal(JSON.parse(h.saved.get('gridlens.pro.activation')).instanceId,id);
});
test('Does not store an invalid restored activation', async () => {
  const h=harness((op,fields)=>({valid:false,error:'revoked'}));
  assert.deepEqual(await h.client.restore(key,id),{allowed:false,reason:'rejected'});
  assert.equal(h.saved.size,0);
});
test('Clock rollback invalidates the cache and checks the service', async () => {
  const h=harness(); await h.client.activate(key);
  h.advance(-1);
  assert.deepEqual(await h.client.validate(),{allowed:true});
  assert.deepEqual(h.calls.map(c=>c.operation),['validate','activate','validate']);
});
test('forgetLocal removes only local state and makes no remote request', async () => {
  const h=harness(); await h.client.activate(key); const count=h.calls.length;
  assert.deepEqual(await h.client.forgetLocal(),{allowed:false,reason:'forgotten'});
  assert.equal(h.saved.size,0); assert.equal(h.calls.length,count);
});
test('Failed secret storage attempts remote cleanup and never grants access', async () => {
  const h=harness(); h.secrets.store=async()=>{throw new Error('OS secret store locked');};
  assert.deepEqual(await h.client.activate(key),{allowed:false,reason:'storage'});
  assert.deepEqual(h.calls.map(c=>c.operation),['validate','activate','deactivate']);
});
test('Concurrent activations are serialized to avoid duplicate activation slots', async () => {
  const h=harness(); const results=await Promise.all([h.client.activate(key),h.client.activate(key)]);
  assert.equal(results.every(r=>r.allowed),true);
  assert.equal(h.calls.filter(c=>c.operation==='activate').length,1);
});