export function domainModule({ discipline }) {
  return { instructions: discipline ? `## DOMAIN DISCIPLINE\n${discipline}` : "", tools: [] };
}
