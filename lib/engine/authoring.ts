import type { HuntDefinition, HuntSettings } from './types'
import { nodeTargets } from './validation'

export const newHuntSettings: HuntSettings = { minTeamSize: 2, maxTeamSize: 4, sessionDurationSeconds: 7200, assignmentVersion: 2 }

/** Bounded reachability warnings, not an automatic difficulty/balance judgement. */
export function authoringWarnings(hunt: HuntDefinition): string[] {
  const warnings: string[] = []
  if (new TextEncoder().encode(JSON.stringify(hunt)).length > 450000) warnings.push('This hunt is close to or above the 512 KB authoring request limit. Split oversized flows or shorten embedded text before publishing; upload media instead of embedding bytes.')
  for (const checkpoint of hunt.checkpoints) {
    const nodes = new Map(checkpoint.flow.nodes.map(node => [node.id, node]))
    const reachable = (start: string, stop?: string) => {
      const found = new Set<string>(), queue = [start]
      while (queue.length) {
        const id = queue.pop()!
        if (found.has(id) || id === stop) continue
        found.add(id); const node = nodes.get(id)
        if (node) queue.push(...nodeTargets(node))
      }
      return found
    }
    const routers = checkpoint.flow.nodes.filter(node => node.type === 'random_branch')
    for (const router of routers) {
      const routes = router.choices.map(choice => reachable(choice.next))
      const beforeRouter = reachable(checkpoint.flow.startNodeId, router.id)
      const possiblePoints = routes.map(route => [...route].reduce((sum, id) => { const node = nodes.get(id); return sum + (node?.type === 'add_points' ? node.amount : 0) }, 0))
      if (new Set(possiblePoints).size > 1) warnings.push(`${checkpoint.title}: routes from ${router.id} contain different automatic point totals. Compare scoring and difficulty manually; conditional totals are not guaranteed awards.`)
      for (const hint of checkpoint.hints) {
        if (!hint.relevance) warnings.push(`${checkpoint.title}: “${hint.title || hint.id}” is checkpoint-wide and may describe another route. Target a step when it is route-specific.`)
        else for (const id of hint.availability?.afterHintIds ?? []) {
          const prerequisite = checkpoint.hints.find(item => item.id === id)
          if (prerequisite?.relevance && !beforeRouter.has(prerequisite.relevance.nodeId) && routes.some(route => route.has(hint.relevance!.nodeId) && !route.has(prerequisite.relevance!.nodeId))) warnings.push(`${checkpoint.title}: “${hint.title || hint.id}” may depend on a hint from a different route.`)
        }
      }
    }
    for (const hint of checkpoint.hints) if (hint.availability?.afterHintIds?.some(id => checkpoint.hints.find(item => item.id === id)?.enabled === false)) warnings.push(`${checkpoint.title}: “${hint.title || hint.id}” depends on a disabled hint.`)
  }
  return [...new Set(warnings)]
}
