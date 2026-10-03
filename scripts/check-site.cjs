const {spawnSync} = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const {chromium} = require('playwright-core');
const root=path.resolve(__dirname,'..');
const live=process.argv.includes('--live');
const base=live?'https://dilojbusiness-blip.github.io/gridlens/':'http://127.0.0.1:8892/docs/';
function contrast(hexA,hexB) {
  const luminance=hex=>{
    const channels=hex.replace('#','').match(/.{2}/g).map(n=>parseInt(n,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);
    return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
  };
  const a=luminance(hexA),b=luminance(hexB);
  return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}
(async()=>{
  const build=spawnSync(process.execPath,[path.join(root,'scripts/build-site.cjs')],{cwd:root,encoding:'utf8'});
  if(build.status!==0)throw new Error('Demo worker build failed');
  const output=live?'D:/VSCodeData/Temp/gridlens-site-live-check':'D:/VSCodeData/Temp/gridlens-site-check'; await fs.mkdir(output,{recursive:true});
  const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    const errors=[],outbound=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{if(!r.url().startsWith(base))outbound.push(r.url());});
    const response=await page.goto(base+'compare-csv-by-key.html');
    assert.equal(response.status(),200);
    await page.getByRole('button',{name:'Load sample',exact:true}).click();
    await page.getByRole('button',{name:'Compare',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Comparison complete'));
    assert.ok((await page.locator('#results').innerText()).includes('2 changed'));
    assert.ok((await page.locator('#results').innerText()).includes('02.00'));
    await page.screenshot({path:path.join(output,'desktop.png')});
    await page.locator('#left-key').fill('2');
    assert.equal(await page.locator('#results').innerText(),'');
    assert.match(await page.locator('#status').innerText(),/Input changed/);
    await page.locator('#left-key').fill('1');
    await page.getByRole('button',{name:'Load duplicate-key sample',exact:true}).click();
    await page.getByRole('button',{name:'Compare',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Key issues'));
    await page.locator('#left-csv').fill('id,v\n001');
    await page.getByRole('button',{name:'Compare',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Structural issues'));
    await page.locator('#left-csv').fill('id,v\n001,<img src=x onerror=alert(1)>');
    await page.locator('#right-csv').fill('id,v\n001,safe');
    await page.getByRole('button',{name:'Compare',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Comparison complete'));
    assert.equal(await page.locator('#results img').count(),0);
    await page.getByRole('button',{name:'Clear data',exact:true}).click();
    assert.equal(await page.locator('#left-csv').inputValue(),'');
    assert.equal(await page.locator('#right-csv').inputValue(),'');
    await page.goto(base);
    await page.screenshot({path:path.join(output,'homepage-desktop.png'),fullPage:true});
    assert.equal(await page.locator('h1').count(),1);
    assert.equal(await page.locator('.hero-band .btn-primary').getAttribute('href'),'compare-csv-by-key.html');
    for (const scheme of ['light','dark']) {
      await page.emulateMedia({colorScheme:scheme,reducedMotion:'reduce'});
      const tokens=await page.evaluate(()=>{
        const css=getComputedStyle(document.documentElement);
        return Object.fromEntries(['canvas','surface','surface-soft','ink','muted','accent'].map(name=>[name,css.getPropertyValue('--'+name).trim()]));
      });
      for (const text of ['ink','muted','accent']) for (const bg of ['canvas','surface','surface-soft']) assert.ok(contrast(tokens[text],tokens[bg])>=4.5,`Text contrast: ${scheme} ${text}/${bg}`);
      assert.ok(contrast('#10281a','#b3f3cf')>=4.5,'Primary button contrast');
      assert.ok(contrast('#b7c9bc','#244332')>=4.5,'Hero copy contrast');
      for (const width of [320,390,768,1280]) {
        await page.setViewportSize({width,height:900});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Homepage overflow: ${scheme}, ${width}`);
      }
      await page.screenshot({path:path.join(output,`homepage-${scheme}.png`)});
      await page.goto(base+'compare-csv-by-key.html');
      for (const width of [320,390,768,1280]) {
        await page.setViewportSize({width,height:900});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Workspace overflow: ${scheme}, ${width}`);
      }
      await page.getByRole('button',{name:'Load sample',exact:true}).click();
      await page.getByRole('button',{name:'Compare',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Comparison complete'));
      assert.equal(await page.locator('.result-metrics > div').count(),4);
      await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:path.join(output,`workspace-mobile-${scheme}.png`),fullPage:true});
      await page.getByRole('button',{name:'Clear data',exact:true}).click();
      await page.goto(base);
    }
    await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.skip-link').evaluate(el=>el===document.activeElement),true);
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).scrollBehavior),'auto');
    await page.setViewportSize({width:390,height:844});
    await page.goto(base);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(output,'mobile.png')});
    assert.deepEqual(errors,[]); assert.deepEqual(outbound,[]);
    const result={passed:true,checked:new Date().toISOString(),url:base,checks:['sample comparison','stale result invalidation','duplicate blocking','ragged diagnostics','XSS literal rendering','clear input','mobile overflow','no outbound demo requests','light/dark responsive layouts at 320/390/768/1280px','structured result cards','keyboard skip link','reduced motion','primary text and button contrast >=4.5:1'],scope:`Real installed Edge against ${live?'public GitHub Pages':'local documentation'} site; synthetic inputs only, no customer traffic or conversion claims. Contrast checks cover primary token pairs, not a complete accessibility audit.`};
    await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});