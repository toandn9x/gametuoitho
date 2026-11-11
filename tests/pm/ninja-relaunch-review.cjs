// Real Ninja School 1 in Chrome with the local runtime; never runs game JARs on the server.
// Requires the public deployment + CheerpJ CDN; all production API writes are blocked.
// node tests/pm/ninja-relaunch-review.cjs (PLAYWRIGHT_MODULE_PATH / CHROME_PATH optional)
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
(async()=>{
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'gametuoitho-live-ninja-'));
 const context=await chromium.launchPersistentContext(path.join(output,'chrome-profile'),{executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,serviceWorkers:'block',viewport:{width:1280,height:900}});
 const log=[],reports=[],requests=[],errors=[];
 const redact=s=>String(s).replace(/Bearer\s+[^\s"'<>]+/gi,'Bearer [REDACTED]').replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g,'[JWT_REDACTED]');
 try{

  await context.route('**/*',route=>{
   const req=route.request();
   if(new URL(req.url()).pathname==='/emulator/src/main.js')return route.fulfill({contentType:'text/javascript',headers:{'Cache-Control':'no-store'},body:fs.readFileSync('apps/emulator-web/src/main.js')});
   if(new URL(req.url()).pathname==='/emulator/freej2me-web.jar'){
    const data=fs.readFileSync('apps/emulator-web/freej2me-web.jar'),range=req.headers().range;
    let status=200,start=0,end=data.length-1;
    if(range){const m=/^bytes=(\d+)-(\d*)$/.exec(range);if(!m)return route.fulfill({status:416});start=Number(m[1]);end=m[2]?Math.min(end,Number(m[2])):end;status=206;}
    const headers={'Content-Type':'application/java-archive','Cache-Control':'no-store','Accept-Ranges':'bytes'};
    if(status===206)headers['Content-Range']='bytes '+start+'-'+end+'/'+data.length;
    return route.fulfill({status,headers,body:req.method()==='HEAD'?Buffer.alloc(0):data.subarray(start,end+1)});
   }
   if(new URL(req.url()).hostname==='gametuoitho.toandn9x.workers.dev'&&!['GET','HEAD','OPTIONS'].includes(req.method())){
    if(req.url().includes('/reports/crash'))reports.push(JSON.parse(req.postData()||'{}'));
    requests.push({blockedWrite:req.method(),url:req.url()});
    return route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,data:{id:'diagnostic-local-only'}})});
   }
   return route.continue();
  });
  const page=await context.newPage();page.setDefaultTimeout(10000);
  page.on('console',msg=>{const text=redact(msg.text());log.push(text);if(/Error Running|Problem with|Problem Constructing/.test(text))console.log('LOG '+text.slice(0,900));});
  page.on('pageerror',err=>{errors.push(redact(err.stack));console.log('PAGE_ERROR '+redact(err.message));});
  page.on('response',res=>{if(res.status()>=400)requests.push({status:res.status(),url:res.url()});});
  page.on('requestfailed',req=>requests.push({failed:req.failure()?.errorText,url:req.url()}));
  await page.goto('https://gametuoitho.toandn9x.workers.dev/play/ninja-school-1',{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>document.querySelector('iframe')?.contentWindow?.libmidi?.context,{},{timeout:90000});
  await page.locator('[data-emulator-key="Digit5"]:visible').click({delay:100});
  const state=()=>{
   const f=document.querySelector('iframe'),w=f?.contentWindow,d=f?.contentDocument;
   return{src:f?.src,started:w?.evtQueue?.started,audio:w?.libmidi?.context?.state,loadingHidden:d?.querySelector('#loading')?.hidden,text:d?.body?.innerText?.slice(-3000),diagnostics:w?.emulatorDiagnostics?.snapshot()};
  };
  await page.waitForFunction(()=>{const f=document.querySelector('iframe'),d=f?.contentDocument;return (f?.contentWindow?.evtQueue?.started&&d?.querySelector('#loading')?.hidden)||d?.querySelector('#btn-retry');},{},{timeout:60000}).catch(e=>console.log('BOOT_WAIT '+e.message.split('\n')[0]));
  await page.waitForTimeout(1500);console.log('STATE '+JSON.stringify({loaded:(await page.evaluate(state)).loadingHidden}));
  const initialAddress=await page.evaluate(()=>localStorage.getItem('pl.zb3.freej2me.bluetoothAddress'));
  require('node:assert/strict').match(initialAddress,/^[0-9A-F]{12}$/);

  for(let attempt=2;attempt<=6&&!reports.length;attempt++){
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('iframe')?.contentWindow?.libmidi?.context,{},{timeout:60000});
    await page.locator('[data-emulator-key="Digit5"]:visible').click({delay:100});
    await page.waitForFunction(()=>{const f=document.querySelector('iframe'),d=f?.contentDocument;return(f?.contentWindow?.evtQueue?.started&&d?.querySelector('#loading')?.hidden)||d?.querySelector('#btn-retry');},{},{timeout:30000});
    await page.waitForTimeout(1200);
    const result=await page.evaluate(state);
    require('node:assert/strict').equal(await page.evaluate(()=>localStorage.getItem('pl.zb3.freej2me.bluetoothAddress')),initialAddress,'virtual device identity must survive reload');console.log('BOOT '+attempt+' '+JSON.stringify({started:result.started,loaded:result.loadingHidden,error:result.text,identityStable:(await page.evaluate(()=>localStorage.getItem('pl.zb3.freej2me.bluetoothAddress')))===initialAddress}));
  }
  await page.waitForTimeout(4500);
  await page.locator('[data-emulator-key="Digit5"]:visible').click({delay:120});
  await page.waitForTimeout(1500);
  await page.screenshot({path:path.join(output,'boot.png'),fullPage:true});
  const iframe=page.frames().find(f=>f!==page.mainFrame());
  if(iframe)await iframe.evaluate(()=>{const c=document.querySelector('#display');return c?.toDataURL('image/png');}).then(data=>{if(data)fs.writeFileSync(path.join(output,'canvas.png'),Buffer.from(data.split(',')[1],'base64'));}).catch(()=>{});
  fs.writeFileSync(path.join(output,'diagnosis.json'),JSON.stringify({log:log.map(redact),reports,requests,errors},null,2));
  require('node:assert/strict').equal(reports.length,0,'patched emulator must recover the existing failed profile');
  require('node:assert/strict').equal((await page.evaluate(state)).loadingHidden,true);
  require('node:assert/strict').deepEqual(errors,[]);
  console.log('REPORTS '+JSON.stringify(reports));console.log('REQUEST_FAILURES '+JSON.stringify(requests));console.log('Evidence: '+output);
 }finally{await context.close();}
})().catch(err=>{console.error(err.stack);process.exitCode=1});
