export const EXPERIMENTAL_TYPES = new Set(['cli', 'file', 'sql', 'mongodb'])

export function isExperimental(type: string): boolean {
  return EXPERIMENTAL_TYPES.has(type)
}
