// Production HTTP verification; uses an isolated preview, never real team scores.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const origin = process.env.SMOKE_ORIGIN || process.env.APP_ORIGIN || 'http://localhost:3000';
const proofPath = process.argv[3] || '.data/verification/proof.json';
const cookies = new Map();
let teamId;
async function request(route, body, preview = false, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(origin + route, { method, headers: {
    Origin: origin, Cookie: [...cookies].map(([key,value])=>`${key}=${value}`).join('; '),
    ...(preview ? {'X-Hunt-Preview':'1'} : {}), ...(body && !(body instanceof FormData) ? {'Content-Type':'application/json'} : {}),
  }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
  for (const cookie of response.headers.getSetCookie()) {
    const item = cookie.split(';')[0]; const separator = item.indexOf('='); cookies.set(item.slice(0,separator),item.slice(separator+1));
  }
  if (!response.ok) throw new Error(`${route}: ${response.status} ${await response.text()}`);
  return response;
}
const json = async (...args) => (await request(...args)).json();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
if (process.argv[2] === '--verify') {
  const proof = JSON.parse(await readFile(proofPath,'utf8'));
  proof.cookies.forEach(([key,value])=>cookies.set(key,value));
  const result = await json('/api/v2/session',undefined,true);
  assert.equal(result.view.teamId,proof.teamId); assert.equal(result.view.score,120); assert.equal(result.view.status,'completed');
  const media = await request(proof.mediaUrl);
  assert.equal(sha(Buffer.from(await media.arrayBuffer())),proof.mediaHash);
  console.log('Restored session, six completed checkpoints, 120 points and uploaded media match the backup.');
} else {
  assert.equal((await json('/api/v2/health')).status,'ok');
  await json('/api/v2/admin/session',{password:process.env.ORGANIZER_PASSWORD});
  const preview = await json('/api/v2/admin/preview',{huntId:'kalyan-demo'});
  teamId = preview.view.teamId;
  let view = preview.view;
  const send = async command => { const result = await json('/api/v2/command',{teamId,requestId:randomUUID(),command},true); view=result.view; return result.feedback; };
  const next = (checkpointId,nodeId) => send({type:'continue',checkpointId,nodeId});
  const verify = (checkpointId,nodeId,value) => send({type:'verify',checkpointId,nodeId,value});
  await next('beginning','clue'); await verify('beginning','riddle','compass'); await next('beginning','fragment');
  await next('hidden-qr','find');
  assert.equal((await verify('hidden-qr','scan','wrong')).scannerShouldStop,false);
  assert.equal((await verify('hidden-qr','scan','demo-coffee-stash')).status,'dud');
  await verify('hidden-qr','scan','K7DM2Q'); await next('hidden-qr','fragment');
  await next('landmark','clue'); await send({type:'use_fallback',checkpointId:'landmark',nodeId:'nearby'});
  await verify('landmark','workshop','KALYAN'); await next('landmark','camera');
  await send({type:'choose_path',checkpointId:'landmark',nodeId:'verification',choiceId:'observation'});
  await verify('landmark','question','arch'); await next('landmark','fragment');
  await send({type:'submit_puzzle',checkpointId:'puzzle-chain',nodeId:'jigsaw',expectedRevision:0,value:{order:['sky','copper','fern','stone']}});
  await send({type:'submit_puzzle',checkpointId:'puzzle-chain',nodeId:'words',expectedRevision:0,value:{path:[0,1,2,3].map(column=>({row:0,column}))}});
  await send({type:'submit_puzzle',checkpointId:'puzzle-chain',nodeId:'words',expectedRevision:1,value:{path:[0,1,2].map(column=>({row:2,column}))}});
  await verify('puzzle-chain','answer','gate'); await next('puzzle-chain','fragment');
  await send({type:'choose_path',checkpointId:'alternate',nodeId:'route',choiceId:'qr'});
  await verify('alternate','scan','CROSSING'); await next('alternate','fragment');
  await send({type:'submit_puzzle',checkpointId:'finale',nodeId:'final-puzzle',expectedRevision:0,value:{value:'LOOK BEYOND THE OLD GATE'}});
  await next('finale','celebrate');
  assert.equal(view.status,'completed'); assert.equal(view.score,120); assert.equal(view.progress.completed,6);
  const bytes=await sharp({create:{width:32,height:32,channels:3,background:'#157568'}}).png().toBuffer();
  const form=new FormData();form.set('file',new File([bytes],'backup-verification.png',{type:'image/png'}));form.set('requestId',randomUUID());
  const uploaded=await json('/api/v2/admin/media',form);
  const stored=await request(uploaded.media.url);
  const proof={teamId,score:view.score,completed:view.progress.completed,mediaUrl:uploaded.media.url,mediaHash:sha(Buffer.from(await stored.arrayBuffer())),cookies:[...cookies]};
  await mkdir(path.dirname(proofPath),{recursive:true,mode:0o700});
  await writeFile(proofPath,JSON.stringify(proof),{mode:0o600});
  console.log('Production HTTP showcase passed: six checkpoints, wrong/dud QR recovery, puzzles, 120 points; uploaded media verified.');
  console.log(`Private restore proof saved to ${proofPath}. It contains session cookies; keep it private.`);
}
