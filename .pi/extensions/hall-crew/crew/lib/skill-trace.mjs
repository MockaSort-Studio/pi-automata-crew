// Display-only detection of skill use, so the transcript can show it. Nothing here changes what the
// model sees or is sent to it.

// A model loads a skill by reading its SKILL.md; the skill's name is its directory.
export function skillFromRead(toolName, input) {
  if (toolName !== "read" || typeof input?.path !== "string") return undefined;
  return input.path.match(/(?:^|[/\\])([^/\\]+)[/\\]SKILL\.md$/)?.[1];
}

// The user forces a skill with `/skill:<name> [args]`.
export function skillFromCommand(text) {
  return typeof text === "string" ? text.match(/^\/skill:([a-z0-9]+(?:-[a-z0-9]+)*)(?:\s|$)/)?.[1] : undefined;
}
