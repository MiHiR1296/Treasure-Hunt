import '../isolated-database'
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { NextRequest } from 'next/server'
import type { HuntDefinition, VisionTargetProfile } from '../../lib/engine/types'
import { getPool } from '../../lib/server/db'
import { publishHunt } from '../../lib/server/hunts'
import { uploadAsset, uploadPhoto } from '../../lib/server/media'
import { applyTeamCommand, joinTeam, teamView } from '../../lib/server/store'
import { authorizeVisionMedia, claimVisionJob, completeVisionJob, createTargetProfileJob, failVisionJob, getTargetProfileJob, requireVisionWorker } from '../../lib/server/vision-jobs'
import { POST as submitVisionResult } from '../../app/api/v2/vision/result/route'
import { HttpError } from '../../lib/server/security'

const enabled=Boolean(process.env.DATABASE_URL),huntIds:string[]=[],assetIds:string[]=[]
let directory=''
const workerToken='integration-vision-worker-token-000000000000000000000000'
const profile:VisionTargetProfile={version:1,summary:'A red rectangular test marker.',distinguishingFeatures:['Red field','Rectangular outline'],confusingAlternatives:[],referenceSelections:[{index:0,role:'front'},{index:1,role:'detail'}],model:'qwen3.8:27b-mlx',promptVersion:'profile-v1'}

before(async()=>{if(!enabled)return;await getPool().query(await readFile(new URL('../../database/v2.sql',import.meta.url),'utf8'));directory=await mkdtemp(path.join(tmpdir(),'hunt-vision-'));process.env.MEDIA_DIRECTORY=directory;process.env.VISION_WORKER_TOKEN=workerToken;process.env.VISION_MODEL='qwen3.8:27b-mlx'})
after(async()=>{if(!enabled)return;await getPool().query('delete from hunt_v2.hunts where id=any($1::text[])',[huntIds]);await getPool().query('delete from hunt_v2.media where id=any($1::uuid[])',[assetIds]);await getPool().end();if(directory)await rm(directory,{recursive:true,force:true})})

async function fixture() {
  const bytes=await sharp({create:{width:40,height:30,channels:3,background:'#cc2200'}}).png().toBuffer()
  const first=await uploadAsset(randomUUID(),new File([new Uint8Array(bytes)], 'one.png',{type:'image/png'})),second=await uploadAsset(randomUUID(),new File([new Uint8Array(bytes)], 'two.png',{type:'image/png'}));assetIds.push(first.id,second.id)
  const id=`vision-${randomUUID()}`;huntIds.push(id)
  const hunt:HuntDefinition={schemaVersion:1,id,version:1,title:'Vision integration',checkpoints:[{id:'one',title:'One',basePoints:10,hints:[],flow:{startNodeId:'photo',nodes:[
    {id:'photo',type:'verify_image',prompt:'Photograph the marker',referenceImages:[first.url,second.url],vision:{mode:'auto_approve',targetName:'Red test marker',scope:'same_physical_subject',profile,autoApproveThreshold:.98,minimumEvidence:2,requireLocationForAutoApproval:false},next:'done'},
    {id:'done',type:'complete'},
  ]}}]}
  await publishHunt(hunt)
  return {hunt,bytes,references:[first.url,second.url]}
}

async function submitted(hunt:HuntDefinition,bytes:Buffer,name:string) {
  const joined=await joinTeam({huntId:hunt.id,teamName:name,playerName:'Player',pin:'123456',mode:'create'})
  const media=await uploadPhoto(joined.view.teamId,{id:randomUUID(),checkpointId:'one',nodeId:'photo',file:new File([new Uint8Array(bytes)],'candidate.png',{type:'image/png'})})
  const receipt=randomUUID(),command={type:'submit_photo',checkpointId:'one',nodeId:'photo',mediaId:media.id}
  await applyTeamCommand(joined.view.teamId,receipt,command)
  await applyTeamCommand(joined.view.teamId,receipt,command)
  return {teamId:joined.view.teamId,mediaId:media.id}
}

async function result(job:{id:string;leaseToken:string},value:unknown) {
  const request=new NextRequest('http://localhost/api/v2/vision/result',{method:'POST',headers:{Authorization:`Bearer ${workerToken}`,'Content-Type':'application/json'},body:JSON.stringify({jobId:job.id,leaseToken:job.leaseToken,model:'qwen3.8:27b-mlx',promptVersion:'review-v1',result:value})})
  const response=await submitVisionResult(request)
  return {response,body:await response.json()}
}

test('PostgreSQL: photo outbox is atomic, leased media is scoped and qualifying results auto-approve once',{skip:!enabled},async()=>{
  const {hunt,bytes}=await fixture(),submission=await submitted(hunt,bytes,'Automatic team')
  const jobs=await getPool().query("select * from hunt_v2.vision_jobs where media_id=$1",[submission.mediaId]);assert.equal(jobs.rowCount,1)
  assert.equal((await getPool().query("select count(*)::int as count from hunt_v2.command_receipts where team_id=$1",[submission.teamId])).rows[0].count,1)
  assert.throws(()=>requireVisionWorker('Bearer wrong'),(error:unknown)=>error instanceof HttpError&&error.status===401)
  const job=await claimVisionJob('integration-mac');assert.ok(job);assert.equal(job.kind,'photo_review')
  await assert.rejects(authorizeVisionMedia(job.id,submission.mediaId,'wrong'),(error:unknown)=>error instanceof HttpError&&error.status===403)
  await authorizeVisionMedia(job.id,submission.mediaId,job.leaseToken)
  const match={decision:'MATCH',confidence:.99,quality:'usable',profileAgreement:true,evidence:['Red field','Rectangular outline'],reason:'Both stable features agree.',verificationPasses:2}
  const completed=await result(job,match);assert.equal(completed.response.status,200);assert.equal(completed.body.applyStatus,'approved')
  assert.equal((await teamView(submission.teamId)).status,'completed')
  assert.equal(typeof (await getPool().query('select apply_revision from hunt_v2.vision_jobs where id=$1',[job.id])).rows[0].apply_revision,'number')
  await getPool().query("update hunt_v2.vision_jobs set apply_status='pending' where id=$1",[job.id])
  const replay=await result(job,match);assert.equal(replay.response.status,200);assert.equal(replay.body.applyStatus,'approved')
})

test('PostgreSQL: a human decision wins a race with a later worker result',{skip:!enabled},async()=>{
  const {hunt,bytes}=await fixture(),submission=await submitted(hunt,bytes,'Manual team'),job=await claimVisionJob('integration-mac');assert.ok(job)
  const view=await teamView(submission.teamId)
  await applyTeamCommand(submission.teamId,randomUUID(),{type:'approve_action',checkpointId:'one',nodeId:'photo',expectedRevision:view.revision,reason:'Organizer inspected the original image'},'control')
  const match={decision:'MATCH',confidence:.99,quality:'usable',profileAgreement:true,evidence:['Red field','Rectangular outline'],reason:'Both stable features agree.',verificationPasses:2}
  const completed=await result(job,match);assert.equal(completed.response.status,409)
  assert.equal((await getPool().query('select status,apply_status from hunt_v2.vision_jobs where id=$1',[job.id])).rows[0].status,'cancelled')
  assert.equal((await teamView(submission.teamId)).status,'completed')
})

test('PostgreSQL: generated target profiles survive a worker retry and return bounded structured metadata',{skip:!enabled},async()=>{
  const {references}=await fixture(),created=await createTargetProfileJob({targetName:'Red test marker',scope:'same_physical_subject',referenceImages:references})
  const first=await claimVisionJob('integration-mac');assert.ok(first);assert.equal(first.id,created.id);assert.equal(first.kind,'target_profile')
  assert.equal((await failVisionJob({jobId:first.id,leaseToken:first.leaseToken,errorCode:'OLLAMA_UNAVAILABLE'})).status,'queued')
  await getPool().query('update hunt_v2.vision_jobs set available_at=now() where id=$1',[first.id])
  const retry=await claimVisionJob('integration-mac');assert.ok(retry);assert.equal(retry.id,created.id);assert.equal(retry.attempts,2)
  const completed=await completeVisionJob({jobId:retry.id,leaseToken:retry.leaseToken,model:'qwen3.8:27b-mlx',promptVersion:'profile-v1',result:profile})
  assert.equal(completed.status,'completed');assert.deepEqual((await getTargetProfileJob(created.id)).result,profile)
})
