/**
 * Layered prompt composition.
 * Loads PromptFile, composes layers in order, interpolates variables.
 */

import type { PromptFile, PromptLayer, PromptTemplate } from './types'

export interface ConfigCatalogEntry {
  id: string
  name: string
  description?: string
  connector_type: string
  tool_count: number
}

/** Format config catalog for injection into system prompt */
export function buildConfigCatalog(configs: ConfigCatalogEntry[]): string {
  if (configs.length === 0) return '(no configs installed yet)'
  return configs.map((c) => {
    const label = c.name && c.name !== c.id ? `${c.id} (${c.name})` : c.id
    let entry = `- ${label}`
    if (c.description) entry += ` — ${c.description}`
    entry += ` [${c.connector_type}, ${c.tool_count} tools]`
    return entry
  }).join('\n')
}

/** Compose a system prompt from layers defined in a template */
export function composeSystemPrompt(
  promptFile: PromptFile,
  templateId: string,
  variables: Record<string, string> = {},
): string {
  const template: PromptTemplate =
    promptFile.templates.find((t) => t.id === templateId) ?? promptFile.templates[0]

  // Required layers always included; template layers in order (deduplicated)
  const requiredIds = promptFile.layers.filter((l) => l.required).map((l) => l.id)
  const allIds = [...new Set([...requiredIds, ...template.layers])]

  const contents = allIds
    .map((id) => promptFile.layers.find((l) => l.id === id))
    .filter((l): l is PromptLayer => l !== undefined)
    .map((l) => l.content)

  let composed = contents.join('\n\n---\n\n')

  // Replace known variables
  for (const [key, value] of Object.entries(variables)) {
    composed = composed.replaceAll(`{{${key}}}`, value)
  }

  // Remove unreplaced placeholders gracefully
  composed = composed.replaceAll(/\{\{[^}]+\}\}/g, '(not available)')

  return composed
}
