const path = require('node:path');
const fs = require('node:fs/promises');
const { chromium } = require('playwright-core');

(async () => {
  const assets = path.resolve('media/demo'); await fs.mkdir(assets, {recursive:true});
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:true });
  try {
    const page = await browser.newPage({ viewport:{width:1280,height:720}, deviceScaleFactor:1 });
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:8892/preview/');
    await page.getByRole('checkbox',{name:'First row is header'}).check();
    await page.screenshot({path:path.join(assets,'grid.png')});
    await page.getByRole('button',{name:'Compare CSV',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'visible'});
    await page.screenshot({path:path.join(assets,'compare.png')});
    await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('gridcell',{name:'02.00',exact:true}).click();
    await page.getByRole('button',{name:'Column summary',exact:true}).click();
    await page.screenshot({path:path.join(assets,'summary.png')});
    if(errors.length) throw new Error(errors.join('; '));
    console.log('Captured synthetic preview screenshots. Real provider/file I/O tested separately in the extension-host suite.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});