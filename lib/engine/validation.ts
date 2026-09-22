import { validatePuzzle } from './puzzles'
import { EngineError, type FlowNode, type GameCommand, type HuntDefinition, type OrganizerControl, type ValidationIssue } from './types'

type ObjectValue = Record<string, unknown>
const unsafeIds = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype'])
const isObject = (value: unknown): value is ObjectValue => typeof value === 'object' && value !== null && !Array.isArray(value)
const isId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value) && !unsafeIds.has(value)
const inRange = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const isRevision = (v: unknown): v is number => inRange(v, 0, Number.MAX_SAFE_INTEGER) && Number.isSafeInteger(v)
const variable = (v: unknown) => typeof v === 'boolean' || (typeof v === 'string' && v.length <= 1000) || inRange(v, -1e9, 1e9)
const mediaUrl = (v: unknown): boolean => {
  if (typeof v !== 'string' || v.length > 2048 || /[\s\\]/.test(v)) return false
  if (/^\/(?!\/)/.test(v)) return true
  try { const url = new URL(v); return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password } catch { return false }
}
export function nodeTargets(node: FlowNode): string[] {
  const targets = node.type === 'choose_path' || node.type === 'random_branch' ? node.choices.map(choice => choice.next)
    : node.type === 'branch' ? [node.ifTrue, node.ifFalse] : node.type === 'complete' ? [] : [node.next]
  if ('fallback' in node && node.fallback) targets.push(node.fallback.nodeId)
  return targets
}

/** Shape, private module configuration and graph validation run before publication. */
export function validateHunt(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const issue = (path: string, message: string) => { issues.push({ path, message }) }
  const object = (v: unknown, path: string, keys: string[]): v is ObjectValue => {
    if (!isObject(v)) { issue(path, 'Must be an object.'); return false }
    for (const key of Object.keys(v)) if (!keys.includes(key)) issue(`${path}.${key}`, 'Unsupported configuration field.')
    return true
  }
  const string = (v: unknown, path: string, max = 20000) => { if (typeof v !== 'string' || !v.trim() || v.length > max) issue(path, `Must be nonempty text of at most ${max} characters.`) }
  const id = (v: unknown, path: string) => { if (!isId(v)) issue(path, 'Use letters, digits, underscores or hyphens in a unique identifier (maximum 100 characters).') }
  const number = (v: unknown, path: string, min: number, max: number, integer = false) => { if (!inRange(v, min, max) || (integer && !Number.isSafeInteger(v))) issue(path, `Must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}.`) }
  const boolean = (v: unknown, path: string) => { if (typeof v !== 'boolean') issue(path, 'Must be true or false.') }
  const choice = (v: unknown, path: string, values: unknown[]) => { if (!values.includes(v)) issue(path, `Choose one of: ${values.join(', ')}.`) }
  const array = (v: unknown, path: string, min: number, max: number): v is unknown[] => { if (!Array.isArray(v) || v.length < min || v.length > max) { issue(path, `Must contain ${min} to ${max} items.`); return false } return true }
  const url = (v: unknown, path: string) => { if (!mediaUrl(v)) issue(path, 'Use an HTTPS URL or a local absolute path without spaces.') }
  const coordinates = (v: ObjectValue, path: string) => { number(v.latitude, `${path}.latitude`, -90, 90); number(v.longitude, `${path}.longitude`, -180, 180) }
  const optionalCoordinates = (v: ObjectValue, path: string) => { if (v.latitude !== undefined || v.longitude !== undefined) coordinates(v, path) }
  const region = (v: unknown, path: string, accuracy: boolean) => {
    if (!object(v, path, ['latitude', 'longitude', 'radiusMeters', ...(accuracy ? ['maxAccuracyMeters'] : [])])) return
    coordinates(v, path); number(v.radiusMeters, `${path}.radiusMeters`, 1, 100000)
    if (accuracy) number(v.maxAccuracyMeters, `${path}.maxAccuracyMeters`, 1, 100000)
  }
  const puzzle = (v: unknown, path: string) => { for (const message of validatePuzzle(v)) issue(path, message) }
  const content = (v: unknown, path: string, allowPuzzle: boolean) => {
    if (!isObject(v)) { issue(path, 'Must be a content object.'); return }
    switch (v.type) {
      case 'text': object(v, path, ['type', 'text']); string(v.text, `${path}.text`); break
      case 'image': object(v, path, ['type', 'url', 'alt']); url(v.url, `${path}.url`); string(v.alt, `${path}.alt`, 1000); break
      case 'map': object(v, path, ['type', 'latitude', 'longitude', 'radiusMeters']); coordinates(v, path); number(v.radiusMeters, `${path}.radiusMeters`, 1, 100000); break
      case 'audio': case 'video':
        object(v, path, ['type', 'url', 'title', 'transcript']); url(v.url, `${path}.url`); string(v.title, `${path}.title`, 200)
        if (v.transcript !== undefined) string(v.transcript, `${path}.transcript`)
        break
      case 'camera':
        object(v, path, ['type', 'referenceImageUrl', 'description', 'latitude', 'longitude']); string(v.description, `${path}.description`)
        if (v.referenceImageUrl !== undefined) url(v.referenceImageUrl, `${path}.referenceImageUrl`)
        optionalCoordinates(v, path); break
      case 'puzzle':
        if (!allowPuzzle) { issue(path, 'Puzzle rewards must be display content, not another puzzle.'); break }
        object(v, path, ['type', 'puzzle', 'reveal']); puzzle(v.puzzle, `${path}.puzzle`); content(v.reveal, `${path}.reveal`, false); break
      default: issue(`${path}.type`, 'Unsupported content type.')
    }
  }
  if (!object(value, 'hunt', ['schemaVersion', 'id', 'version', 'title', 'description', 'checkpoints', 'dudQrs', 'settings', 'theme'])) return issues
  if (value.schemaVersion !== 1) issue('hunt.schemaVersion', 'Only schema version 1 is supported.')
  id(value.id, 'hunt.id'); number(value.version, 'hunt.version', 1, Number.MAX_SAFE_INTEGER, true); string(value.title, 'hunt.title', 200)
  if (value.description !== undefined) string(value.description, 'hunt.description')
  if (value.settings !== undefined && object(value.settings, 'hunt.settings', ['mode', 'leaderboard', 'ranking', 'map', 'rules', 'maxTeamSize', 'registrationOpen', 'startsAt', 'endsAt', 'completionMessage', 'photoRetention'])) {
    const s = value.settings
    const enums = { mode: ['sequential', 'open', 'dependency'], leaderboard: ['live', 'hidden', 'finish'], ranking: ['points', 'progress', 'points_time'], map: ['none', 'all', 'visited'], photoRetention: ['after_verification', 'after_event', 'retain'] }
    for (const [key, values] of Object.entries(enums)) if (s[key] !== undefined) choice(s[key], `hunt.settings.${key}`, values)
    for (const key of ['rules', 'completionMessage']) if (s[key] !== undefined) string(s[key], `hunt.settings.${key}`)
    if (s.maxTeamSize !== undefined) number(s.maxTeamSize, 'hunt.settings.maxTeamSize', 1, 1000, true)
    if (s.registrationOpen !== undefined) boolean(s.registrationOpen, 'hunt.settings.registrationOpen')
    for (const key of ['startsAt', 'endsAt']) if (s[key] !== undefined && (typeof s[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(s[key]) || !Number.isFinite(Date.parse(s[key])))) issue(`hunt.settings.${key}`, 'Use a valid ISO timestamp with a timezone.')
    if (typeof s.startsAt === 'string' && typeof s.endsAt === 'string' && Date.parse(s.endsAt) <= Date.parse(s.startsAt)) issue('hunt.settings.endsAt', 'End time must be after start time.')
  }
  if (value.theme !== undefined && object(value.theme, 'hunt.theme', ['primaryColor', 'logoUrl', 'coverUrl', 'backgroundUrl', 'font', 'feedback', 'buttonShape', 'checkpointIconStyle', 'successAnimation'])) {
    const theme = value.theme
    if (theme.primaryColor !== undefined && (typeof theme.primaryColor !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(theme.primaryColor))) issue('hunt.theme.primaryColor', 'Use a six-digit hex color such as #047857.')
    for (const key of ['logoUrl', 'coverUrl', 'backgroundUrl']) if (theme[key] !== undefined) url(theme[key], `hunt.theme.${key}`)
    if (theme.font !== undefined) choice(theme.font, 'hunt.theme.font', ['system', 'serif'])
    if (theme.feedback !== undefined) boolean(theme.feedback, 'hunt.theme.feedback')
    if (theme.buttonShape !== undefined) choice(theme.buttonShape, 'hunt.theme.buttonShape', ['rounded', 'pill', 'square'])
    if (theme.checkpointIconStyle !== undefined) choice(theme.checkpointIconStyle, 'hunt.theme.checkpointIconStyle', ['numbers', 'symbols', 'none'])
    if (theme.successAnimation !== undefined) choice(theme.successAnimation, 'hunt.theme.successAnimation', ['none', 'pulse', 'celebrate'])
  }
  if (array(value.checkpoints, 'hunt.checkpoints', 1, 100)) value.checkpoints.forEach((checkpoint, ci) => {
    const path = `hunt.checkpoints[${ci}]`
    if (!object(checkpoint, path, ['id', 'title', 'basePoints', 'flow', 'hints', 'required', 'prerequisites', 'group', 'location', 'wrongAttemptPenalty', 'skipPenalty', 'timeBonus'])) return
    id(checkpoint.id, `${path}.id`); string(checkpoint.title, `${path}.title`, 200); number(checkpoint.basePoints, `${path}.basePoints`, 0, 1000000, true)
    if (checkpoint.required !== undefined) boolean(checkpoint.required, `${path}.required`)
    if (checkpoint.group !== undefined) string(checkpoint.group, `${path}.group`, 200)
    if (checkpoint.prerequisites !== undefined && array(checkpoint.prerequisites, `${path}.prerequisites`, 0, 100)) checkpoint.prerequisites.forEach((ref, i) => id(ref, `${path}.prerequisites[${i}]`))
    if (checkpoint.location !== undefined) region(checkpoint.location, `${path}.location`, false)
    for (const key of ['wrongAttemptPenalty', 'skipPenalty']) if (checkpoint[key] !== undefined) number(checkpoint[key], `${path}.${key}`, 0, 1000000, true)
    if (checkpoint.timeBonus !== undefined && object(checkpoint.timeBonus, `${path}.timeBonus`, ['withinSeconds', 'points'])) { number(checkpoint.timeBonus.withinSeconds, `${path}.timeBonus.withinSeconds`, 1, 31536000, true); number(checkpoint.timeBonus.points, `${path}.timeBonus.points`, 0, 1000000, true) }
    if (object(checkpoint.flow, `${path}.flow`, ['startNodeId', 'nodes'])) {
      id(checkpoint.flow.startNodeId, `${path}.flow.startNodeId`)
      if (array(checkpoint.flow.nodes, `${path}.flow.nodes`, 1, 200)) checkpoint.flow.nodes.forEach((node, ni) => {
        const np = `${path}.flow.nodes[${ni}]`
        if (!isObject(node)) { issue(np, 'Must be a node object.'); return }
        const fields: Record<string, string[]> = {
          show_text: ['text', 'next'], show_media: ['content', 'next'], verify_qr: ['prompt', 'token', 'backupCode', 'next'], verify_code: ['prompt', 'code', 'caseSensitive', 'recapAnswer', 'next'], verify_answer: ['prompt', 'answers', 'caseSensitive', 'recapAnswer', 'next'],
          verify_gps: ['prompt', 'latitude', 'longitude', 'radiusMeters', 'maxAccuracyMeters', 'next'], choose_path: ['prompt', 'choices'], puzzle: ['prompt', 'puzzle', 'next'], camera_guide: ['prompt', 'referenceImageUrl', 'latitude', 'longitude', 'next'], verify_organizer: ['prompt', 'next'], verify_image: ['prompt', 'referenceImages', 'location', 'next'],
          set_variable: ['key', 'value', 'next'], branch: ['condition', 'ifTrue', 'ifFalse'], random_branch: ['choices'], add_points: ['amount', 'label', 'next'], complete: [],
        }
        if (typeof node.type !== 'string' || !Object.hasOwn(fields, node.type)) { issue(`${np}.type`, 'Unsupported action type.'); return }
        const automatic = ['complete', 'set_variable', 'branch', 'random_branch', 'add_points'].includes(node.type)
        object(node, np, ['id', 'type', ...fields[node.type], ...(automatic ? [] : ['fallback'])]); id(node.id, `${np}.id`)
        if (fields[node.type].includes('prompt')) string(node.prompt, `${np}.prompt`)
        if (fields[node.type].includes('next')) id(node.next, `${np}.next`)
        if (node.fallback !== undefined && !automatic && object(node.fallback, `${np}.fallback`, ['nodeId', 'label', 'enabled'])) { id(node.fallback.nodeId, `${np}.fallback.nodeId`); string(node.fallback.label, `${np}.fallback.label`, 200); boolean(node.fallback.enabled, `${np}.fallback.enabled`) }
        if (node.type === 'show_text') string(node.text, `${np}.text`)
        if (node.type === 'show_media') content(node.content, `${np}.content`, false)
        if (node.type === 'verify_qr') { string(node.token, `${np}.token`, 2048); if (node.backupCode !== undefined) string(node.backupCode, `${np}.backupCode`, 200) }
        if (node.type === 'verify_code') string(node.code, `${np}.code`, 2048)
        if (node.type === 'verify_answer' && array(node.answers, `${np}.answers`, 1, 100)) node.answers.forEach((answer, i) => string(answer, `${np}.answers[${i}]`, 2048))
        if (node.caseSensitive !== undefined) boolean(node.caseSensitive, `${np}.caseSensitive`)
        if (node.recapAnswer !== undefined) string(node.recapAnswer, `${np}.recapAnswer`, 500)
        if (node.type === 'verify_gps') { coordinates(node, np); number(node.radiusMeters, `${np}.radiusMeters`, 1, 100000); number(node.maxAccuracyMeters, `${np}.maxAccuracyMeters`, 1, 100000) }
        if (node.type === 'camera_guide') { optionalCoordinates(node, np); if (node.referenceImageUrl !== undefined) url(node.referenceImageUrl, `${np}.referenceImageUrl`) }
        if (node.type === 'verify_image') { if (array(node.referenceImages, `${np}.referenceImages`, 0, 30)) node.referenceImages.forEach((ref, i) => url(ref, `${np}.referenceImages[${i}]`)); if (node.location !== undefined) region(node.location, `${np}.location`, true) }
        if (node.type === 'puzzle') puzzle(node.puzzle, `${np}.puzzle`)
        if (node.type === 'choose_path' && array(node.choices, `${np}.choices`, 2, 20)) node.choices.forEach((option, i) => { const op = `${np}.choices[${i}]`; if (object(option, op, ['id', 'label', 'next'])) { id(option.id, `${op}.id`); string(option.label, `${op}.label`, 200); id(option.next, `${op}.next`) } })
        if (node.type === 'random_branch' && array(node.choices, `${np}.choices`, 2, 20)) node.choices.forEach((option, i) => { const op = `${np}.choices[${i}]`; if (object(option, op, ['next', 'weight'])) { id(option.next, `${op}.next`); number(option.weight, `${op}.weight`, 1, 10000, true) } })
        if (node.type === 'set_variable') { id(node.key, `${np}.key`); if (!variable(node.value)) issue(`${np}.value`, 'Use a bounded string, number or boolean.') }
        if (node.type === 'add_points') { number(node.amount, `${np}.amount`, -1000000, 1000000, true); string(node.label, `${np}.label`, 200) }
        if (node.type === 'branch') {
          id(node.ifTrue, `${np}.ifTrue`); id(node.ifFalse, `${np}.ifFalse`)
          const c = node.condition, cp = `${np}.condition`
          if (!isObject(c)) issue(cp, 'A branch condition is required.')
          else if (c.type === 'variable') { object(c, cp, ['type', 'key', 'equals']); id(c.key, `${cp}.key`); if (!variable(c.equals)) issue(`${cp}.equals`, 'Use a bounded string, number or boolean.') }
          else if (c.type === 'checkpoint_completed') { object(c, cp, ['type', 'checkpointId']); id(c.checkpointId, `${cp}.checkpointId`) }
          else if (c.type === 'hint_used') { object(c, cp, ['type', 'hintId']); id(c.hintId, `${cp}.hintId`) }
          else if (c.type === 'time') { object(c, cp, ['type', 'after', 'before']); for (const key of ['after', 'before']) if (typeof c[key] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(c[key])) issue(`${cp}.${key}`, 'Use 24-hour UTC time HH:MM.') }
          else issue(cp, 'Unsupported branch condition.')
        }
      })
    }
    if (array(checkpoint.hints, `${path}.hints`, 0, 100)) checkpoint.hints.forEach((hint, hi) => {
      const hp = `${path}.hints[${hi}]`
      if (!object(hint, hp, ['id', 'title', 'cost', 'content', 'availability'])) return
      id(hint.id, `${hp}.id`); string(hint.title, `${hp}.title`, 200); number(hint.cost, `${hp}.cost`, 0, 1000000, true); content(hint.content, `${hp}.content`, true)
      if (hint.availability !== undefined && object(hint.availability, `${hp}.availability`, ['afterHintIds', 'afterSeconds', 'afterNodeId'])) {
        if (hint.availability.afterSeconds !== undefined) number(hint.availability.afterSeconds, `${hp}.availability.afterSeconds`, 0, 31536000, true)
        if (hint.availability.afterNodeId !== undefined) id(hint.availability.afterNodeId, `${hp}.availability.afterNodeId`)
        if (hint.availability.afterHintIds !== undefined && array(hint.availability.afterHintIds, `${hp}.availability.afterHintIds`, 0, 100)) hint.availability.afterHintIds.forEach((ref, i) => id(ref, `${hp}.availability.afterHintIds[${i}]`))
      }
    })
  })
  if (value.dudQrs !== undefined && array(value.dudQrs, 'hunt.dudQrs', 0, 1000)) value.dudQrs.forEach((dud, i) => { const dp = `hunt.dudQrs[${i}]`; if (object(dud, dp, ['token', 'message', 'points'])) { string(dud.token, `${dp}.token`, 2048); string(dud.message, `${dp}.message`, 1000); if (dud.points !== undefined) number(dud.points, `${dp}.points`, -1000000, 1000000, true) } })
  if (issues.length) return issues
  const hunt = value as unknown as HuntDefinition
  const checkpointIds = new Set(hunt.checkpoints.map(cp => cp.id))
  if (checkpointIds.size !== hunt.checkpoints.length) issue('hunt.checkpoints', 'Checkpoint IDs must be unique.')
  if (!hunt.checkpoints.some(cp => cp.required !== false)) issue('hunt.checkpoints', 'At least one checkpoint must be required.')
  const hintIds = new Set<string>(), qrTokens = new Set<string>()
  const acyclic = (startIds: string[], edges: (id: string) => string[], exists: (id: string) => boolean, path: string) => {
    const visited = new Set<string>(), visiting = new Set<string>()
    const visit = (nodeId: string) => {
      if (!exists(nodeId)) { issue(path, `Referenced object ${nodeId} does not exist.`); return }
      if (visiting.has(nodeId)) { issue(path, `Cycle detected at ${nodeId}. Retry stays within the active task and does not need a cycle.`); return }
      if (visited.has(nodeId)) return
      visiting.add(nodeId); for (const target of edges(nodeId)) visit(target); visiting.delete(nodeId); visited.add(nodeId)
    }
    for (const start of startIds) visit(start)
    return visited
  }
  for (const [ci, checkpoint] of hunt.checkpoints.entries()) {
    const path = `checkpoint:${checkpoint.id}`, nodes = new Map(checkpoint.flow.nodes.map(node => [node.id, node]))
    if (nodes.size !== checkpoint.flow.nodes.length) issue(`${path}.flow`, 'Node IDs must be unique within a checkpoint.')
    for (const ref of checkpoint.prerequisites ?? []) {
      if (!checkpointIds.has(ref)) issue(`${path}.prerequisites`, `Required checkpoint ${ref} does not exist.`)
      if ((hunt.settings?.mode ?? 'sequential') === 'sequential' && !hunt.checkpoints.slice(0, ci).some(cp => cp.id === ref)) issue(`${path}.prerequisites`, 'Sequential checkpoints can require only earlier checkpoints.')
    }
    for (const node of nodes.values()) {
      if (node.type === 'verify_qr') qrTokens.add(node.token)
      for (const target of nodeTargets(node)) if (!nodes.has(target)) issue(`${path}.node:${node.id}`, `Next node ${target} does not exist.`)
      if (node.type === 'choose_path' && new Set(node.choices.map(c => c.id)).size !== node.choices.length) issue(`${path}.node:${node.id}`, 'Choice IDs must be unique.')
    }
    const visited = acyclic([checkpoint.flow.startNodeId], id => nodeTargets(nodes.get(id)!), id => nodes.has(id), `${path}.flow`)
    for (const node of nodes.values()) if (!visited.has(node.id)) issue(`${path}.node:${node.id}`, 'Node is unreachable from the start.')
    if (!checkpoint.flow.nodes.some(node => node.type === 'complete')) issue(`${path}.flow`, 'Flow must reach a complete action.')
    const hints = new Map(checkpoint.hints.map(hint => [hint.id, hint]))
    for (const hint of checkpoint.hints) {
      if (hintIds.has(hint.id)) issue(`hint:${hint.id}`, 'Hint IDs must be unique across the hunt.')
      hintIds.add(hint.id)
      if (hint.availability?.afterNodeId && !nodes.has(hint.availability.afterNodeId)) issue(`hint:${hint.id}`, 'The availability action does not exist.')
    }
    acyclic([...hints.keys()], id => hints.get(id)!.availability?.afterHintIds ?? [], id => hints.has(id), `${path}.hints`)
  }
  const byId = new Map(hunt.checkpoints.map(cp => [cp.id, cp]))
  acyclic([...checkpointIds], id => byId.get(id)!.prerequisites ?? [], id => byId.has(id), 'hunt.checkpoints.prerequisites')
  for (const cp of hunt.checkpoints) for (const node of cp.flow.nodes) if (node.type === 'branch') {
    if (node.condition.type === 'checkpoint_completed' && !checkpointIds.has(node.condition.checkpointId)) issue(`node:${node.id}.condition`, 'The referenced checkpoint does not exist.')
    if (node.condition.type === 'hint_used' && !hintIds.has(node.condition.hintId)) issue(`node:${node.id}.condition`, 'The referenced hint does not exist.')
  }
  const dudTokens = new Set<string>()
  for (const dud of hunt.dudQrs ?? []) { if (dudTokens.has(dud.token)) issue('hunt.dudQrs', 'Dud tokens must be unique.'); if (qrTokens.has(dud.token)) issue('hunt.dudQrs', 'A dud token cannot also verify a checkpoint.'); dudTokens.add(dud.token) }
  return issues
}
export function parseHuntDefinition(value: unknown): HuntDefinition {
  const issues = validateHunt(value)
  if (issues.length) throw new EngineError('invalid_definition', issues.map(i => `${i.path}: ${i.message}`).join('\n'))
  return JSON.parse(JSON.stringify(value)) as HuntDefinition
}
function jsonValue(value: unknown, depth = 0): boolean {
  if (depth > 20) return false
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.length <= 10000 && value.every(v => jsonValue(v, depth + 1))
  return isObject(value) && Object.entries(value).every(([k, v]) => !unsafeIds.has(k) && jsonValue(v, depth + 1))
}
export function parseCommand(value: unknown): GameCommand {
  const invalid = (): never => { throw new EngineError('invalid_command', 'That action could not be understood. Refresh and try again.') }
  if (!isObject(value) || !isId(value.checkpointId) || typeof value.type !== 'string') return invalid()
  const fields: Record<string, string[]> = {
    continue: ['nodeId'], verify: ['nodeId', 'value'], verify_gps: ['nodeId', 'location'], choose_path: ['nodeId', 'choiceId'], use_hint: ['hintId'], choose_checkpoint: [], use_fallback: ['nodeId'],
    save_puzzle: ['nodeId', 'expectedRevision', 'value'], submit_puzzle: ['nodeId', 'expectedRevision', 'value'], save_hint_puzzle: ['hintId', 'expectedRevision', 'value'], submit_hint_puzzle: ['hintId', 'expectedRevision', 'value'], submit_photo: ['nodeId', 'mediaId'],
  }
  if (!Object.hasOwn(fields, value.type)) return invalid()
  const permittedFields = fields[value.type]
  if (Object.keys(value).some(key => !['type', 'checkpointId', ...permittedFields].includes(key))) return invalid()
  if (fields[value.type].includes('nodeId') && !isId(value.nodeId)) return invalid()
  if (fields[value.type].includes('hintId') && !isId(value.hintId)) return invalid()
  if (value.type === 'verify' && (typeof value.value !== 'string' || !value.value.trim() || value.value.length > 2048)) return invalid()
  if (value.type === 'choose_path' && !isId(value.choiceId)) return invalid()
  if (value.type === 'verify_gps') {
    const loc = value.location
    if (!isObject(loc) || Object.keys(loc).some(key => !['latitude', 'longitude', 'accuracyMeters'].includes(key)) || !inRange(loc.latitude, -90, 90) || !inRange(loc.longitude, -180, 180) || !inRange(loc.accuracyMeters, 0, 1000000)) return invalid()
  }
  if (value.type.includes('puzzle') && (!isRevision(value.expectedRevision) || !jsonValue(value.value) || JSON.stringify(value.value).length > 64000)) return invalid()
  if (value.type === 'submit_photo' && (typeof value.mediaId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.mediaId))) return invalid()
  return JSON.parse(JSON.stringify(value)) as GameCommand
}
export function parseControl(value: unknown): OrganizerControl {
  const invalid = (): never => { throw new EngineError('invalid_override', 'Choose a current team action and give a brief reason for this intervention.') }
  if (!isObject(value) || typeof value.type !== 'string' || !isRevision(value.expectedRevision) || typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 1000) return invalid()
  const fields: Record<string, string[]> = { approve_action: ['checkpointId', 'nodeId'], skip_action: ['checkpointId', 'nodeId'], reset_action: ['checkpointId', 'nodeId'], reject_photo: ['checkpointId', 'nodeId'], skip_checkpoint: ['checkpointId'], move_checkpoint: ['checkpointId'], adjust_score: ['amount', 'checkpointId'], reset_hint: ['checkpointId', 'hintId'], enable_fallback: ['checkpointId', 'nodeId', 'enabled'] }
  if (!Object.hasOwn(fields, value.type)) return invalid()
  const permittedFields = fields[value.type]
  if (Object.keys(value).some(key => !['type', 'expectedRevision', 'reason', ...permittedFields].includes(key))) return invalid()
  for (const key of ['checkpointId', 'nodeId', 'hintId']) if (fields[value.type].includes(key) && !(value.type === 'adjust_score' && key === 'checkpointId' && value[key] === undefined) && !isId(value[key])) return invalid()
  if (value.type === 'adjust_score' && (!inRange(value.amount, -1000000, 1000000) || !Number.isSafeInteger(value.amount) || value.amount === 0)) return invalid()
  if (value.type === 'enable_fallback' && typeof value.enabled !== 'boolean') return invalid()
  return { ...JSON.parse(JSON.stringify(value)), reason: value.reason.trim() } as OrganizerControl
}
