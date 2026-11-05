import { join } from "node:path";

const githubDiscussionTools = [
  "github_discussion_post",
  "github_discussion_comments",
  "github_discussion_view",
  "github_discussions_list",
];

export function resolveBundles(root, names = []) {
  const tools = new Set();
  const extensionPaths = new Set();
  for (const name of names) {
    if (name !== "github-discussions") throw new Error(`Unknown tool bundle: ${name}`);
    githubDiscussionTools.forEach((tool) => tools.add(tool));
    extensionPaths.add(join(root, ".pi", "extensions", "github", "index.ts"));
  }
  return { tools: [...tools], extensionPaths: [...extensionPaths] };
}
