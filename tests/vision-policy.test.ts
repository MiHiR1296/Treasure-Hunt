import test from 'node:test'
import assert from 'node:assert/strict'
import type { HuntDefinition, VisionReviewConfiguration } from '../lib/engine/types'
import { eligibleForAutoApproval, parseGeneratedVisionProfile, parsePhotoVisionResult } from '../lib/engine/vision'
import { validateHunt } from '../lib/engine/validation'
import { createInitialState, getPlayerView } from '../lib/engine'

const profile = {
  version: 1 as const, summary: 'A stone gateway with two square towers.', distinguishingFeatures: ['Twin square towers','Central pointed arch'],
  confusingAlternatives: ['The smaller east gate'], referenceSelections: [{index:0,role:'wide front view'},{index:1,role:'arch detail'}],
  model:'qwen3.8:27b-mlx',promptVersion:'profile-v1',
}
const configuration: VisionReviewConfiguration = { mode:'auto_approve',targetName:'Durgadi Fort main gate',scope:'same_named_place',profile,
  autoApproveThreshold:.98,minimumEvidence:2,requireLocationForAutoApproval:true }
const match = { decision:'MATCH' as const,confidence:.99,quality:'usable' as const,profileAgreement:true,evidence:['Twin towers','Pointed arch'],reason:'The stable facade details agree.',verificationPasses:2 }

test('automatic vision approval needs every independent policy gate', () => {
  assert.equal(eligibleForAutoApproval(configuration,match,true),true)
  assert.equal(eligibleForAutoApproval(configuration,{...match,confidence:.97},true),false)
  assert.equal(eligibleForAutoApproval(configuration,{...match,verificationPasses:1},true),false)
  assert.equal(eligibleForAutoApproval(configuration,{...match,evidence:['Twin towers']},true),false)
  assert.equal(eligibleForAutoApproval(configuration,{...match,profileAgreement:false},true),false)
  assert.equal(eligibleForAutoApproval(configuration,{...match,quality:'poor'},true),false)
  assert.equal(eligibleForAutoApproval(configuration,{...match,decision:'UNCERTAIN'},true),false)
  assert.equal(eligibleForAutoApproval(configuration,match,false),false)
  assert.equal(eligibleForAutoApproval({...configuration,mode:'assisted'},match,true),false)
  assert.equal(eligibleForAutoApproval({...configuration,profile:undefined},match,true),false)
})

test('worker result parsers reject extra, unbounded and malformed output', () => {
  assert.deepEqual(parsePhotoVisionResult(match),match)
  assert.equal(parsePhotoVisionResult({...match,secret:'hidden reasoning'}),null)
  assert.equal(parsePhotoVisionResult({...match,confidence:4}),null)
  assert.equal(parsePhotoVisionResult({...match,evidence:Array(7).fill('cue')}),null)
  assert.deepEqual(parseGeneratedVisionProfile(profile,2),profile)
  assert.equal(parseGeneratedVisionProfile({...profile,referenceSelections:[{index:0,role:'one'},{index:0,role:'duplicate'}]},2),null)
  assert.equal(parseGeneratedVisionProfile({...profile,promptVersion:'unreviewed'},2),null)
})

test('vision-enabled definitions require managed references and a generated profile for automatic mode', () => {
  const hunt:HuntDefinition = { schemaVersion:1,id:'vision-policy',version:1,title:'Vision',checkpoints:[{id:'one',title:'One',basePoints:10,hints:[],flow:{startNodeId:'photo',nodes:[
    {id:'photo',type:'verify_image',prompt:'Photograph the gate',referenceImages:['https://example.com/one.jpg','https://example.com/two.jpg'],vision:configuration,next:'done'},
    {id:'done',type:'complete'},
  ]}}] }
  assert.ok(validateHunt(hunt).some(issue=>issue.path.includes('referenceImages')))
  const managed=structuredClone(hunt)
  const node=managed.checkpoints[0].flow.nodes[0]
  if(node.type==='verify_image') {
    node.referenceImages=['/api/v2/media/00000000-0000-4000-8000-000000000001','/api/v2/media/00000000-0000-4000-8000-000000000002']
    node.location={latitude:19,longitude:73,radiusMeters:75,maxAccuracyMeters:100}
  }
  assert.deepEqual(validateHunt(managed),[])
  const publicJson=JSON.stringify(getPlayerView(managed,createInitialState(managed,'team','2026-09-30T10:00:00.000Z'),'2026-09-30T10:00:00.000Z'))
  assert.equal(publicJson.includes('Durgadi Fort'),false);assert.equal(publicJson.includes('00000000-0000-4000-8000-000000000001'),false);assert.equal(publicJson.includes('distinguishingFeatures'),false)
  if(node.type==='verify_image'&&node.vision?.profile) node.vision.profile.referenceSelections[1].index=0
  assert.ok(validateHunt(managed).some(issue=>issue.message.includes('only once')))
  if(node.type==='verify_image'&&node.vision?.profile) node.vision.profile.referenceSelections[1].index=1
  if(node.type==='verify_image'&&node.vision) delete node.vision.profile
  assert.ok(validateHunt(managed).some(issue=>issue.path.endsWith('vision.profile')))
})
