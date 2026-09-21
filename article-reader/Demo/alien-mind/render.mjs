// Deterministic 30 fps renderer. No credentials or network calls are used.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const require=createRequire(import.meta.url);
const runtime=process.env.PLAYWRIGHT_MODULE || '/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
const {chromium}=require(runtime);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || '/Users/admin/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'});
const page=await browser.newPage({viewport:{width:540,height:960},deviceScaleFactor:2});
const result=JSON.parse(readFileSync(join(root,'production-result.json')));
let html=readFileSync(join(root,'scene.html'),'utf8');
html=html.replace('/*DEMO_DATA*/',JSON.stringify(result)).replaceAll('OG_DATA',`data:image/png;base64,${readFileSync(join(root,'og.png')).toString('base64')}`);
await page.setContent(html); await page.evaluate(()=>document.fonts.ready);
const seconds=32, fps=30;
mkdirSync(join(root,'frames'),{recursive:true});
const samples=[0,4.7,7.5,Math.min(13,7.4+result.durationSeconds+1),16.6,20,25,31];
for(const t of samples){ await page.evaluate(t=>window.render(t),t); await page.screenshot({path:join(root,'frames',`${t.toFixed(2)}.png`)}); }
if(process.argv.includes('--stills')){await browser.close();process.exit(0);}
const ffmpeg=spawn('ffmpeg',['-y','-f','image2pipe','-framerate',String(fps),'-i','-','-an','-c:v','libx264','-preset','slow','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart','-r',String(fps),join(root,'arctic-jev-linkedin.mp4')],{stdio:['pipe','ignore','pipe']});
let errors=''; ffmpeg.stderr.on('data',d=>errors+=d);
for(let i=0;i<seconds*fps;i++){
 await page.evaluate(t=>window.render(t),i/fps);
 const frame=await page.screenshot({type:'jpeg',quality:96});
 if(!ffmpeg.stdin.write(frame)) await once(ffmpeg.stdin,'drain');
 if(i%150===0)console.log(`Rendered ${i/fps}/${seconds}s`);
}
ffmpeg.stdin.end();const [exit]=await once(ffmpeg,'close');if(exit)throw Error(errors);
await browser.close();
writeFileSync(join(root,'render-info.json'),JSON.stringify({width:1080,height:1920,fps,seconds,taggingRequestSeconds:result.durationSeconds,taggingShownSeconds:Math.min(result.durationSeconds,6),source:'production-result.json',designedReplay:true},null,2));
console.log('MP4 complete');
