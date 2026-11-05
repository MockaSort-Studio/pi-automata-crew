import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { closingCommentBody, contentDigest, truncateForDiscussion, withRecentDigest } from "./discussion-body.mjs";
import { githubCommand, githubError, githubJson } from "./github-error.mjs";

const exec = promisify(execFile);
const query = (text) => ["api", "graphql", "-f", `query=${text}`];
const json = (args, operation, resource) => githubJson(exec, args, operation, resource);
const date = (value) => new Date(value).toISOString().slice(0, 10);

async function repository() {
  const result = await githubCommand(
    exec,
    ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
    "resolve repository",
    "current repository",
  );
  const nameWithOwner = result.stdout?.trim?.() ?? "";
  const [owner, repo] = nameWithOwner.split("/");
  if (!owner || !repo) throw new Error("GitHub adapter requires the current repository");
  return { owner, repo };
}
async function discussion({ owner, repo, runId, startedAt, category }) {
  const resource = `${owner}/${repo}`;
  const categories = await json(
    query(
      "query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){id discussionCategories(first:20){nodes{id name}}}}",
    ).concat(["-f", `owner=${owner}`, "-f", `repo=${repo}`]),
    "list discussion categories",
    resource,
  );
  const repository = categories.data?.repository;
  if (!repository)
    throw githubError(new Error("repository is unavailable or closed"), "list discussion categories", resource);
  const categoryId = repository.discussionCategories?.nodes?.find((item) => item.name === category)?.id;
  if (!categoryId)
    throw githubError(new Error(`Discussion category not found: ${category}`), "resolve discussion category", resource);
  const mutation =
    'mutation($repo:ID!,$category:ID!,$title:String!){createDiscussion(input:{repositoryId:$repo,categoryId:$category,title:$title,body:"Crew communication transcript."}){discussion{id number url}}}';
  const result = await json(
    query(mutation).concat([
      "-f",
      `repo=${repository.id}`,
      "-f",
      `category=${categoryId}`,
      "-f",
      `title=Crew - ${runId} - ${date(startedAt)}`,
    ]),
    "create discussion",
    resource,
  );
  const created = result.data?.createDiscussion?.discussion;
  if (!created)
    throw githubError(new Error("resource is unavailable, closed, or state-conflicted"), "create discussion", resource);
  return created;
}
export const discussionStateFilePath = (crewLaunchDir, runId) => join(crewLaunchDir, `${runId}-github-discussion.json`);

export async function postDiscussionClosingComment(stateFilePath, { status }) {
  let state;
  try {
    state = JSON.parse(await readFile(stateFilePath, "utf8"));
  } catch {
    return { posted: false, reason: "no-discussion" };
  }
  if (state.closedRosterStatus) return { posted: false, reason: "already-closed" };
  const comment = await post(state.id, closingCommentBody());
  state.closedRosterStatus = status;
  state.closedAt = new Date().toISOString();
  await writeFile(stateFilePath, JSON.stringify(state, null, 2));
  return { posted: true, comment };
}

async function post(discussionId, body) {
  const mutation =
    "mutation($id:ID!,$body:String!){addDiscussionComment(input:{discussionId:$id,body:$body}){comment{id url}}}";
  const result = await json(
    query(mutation).concat(["-f", `id=${discussionId}`, "-f", `body=${body}`]),
    "add discussion comment",
    `discussion ${discussionId}`,
  );
  const comment = result.data?.addDiscussionComment?.comment;
  if (!comment)
    throw githubError(
      new Error("resource is unavailable or closed"),
      "add discussion comment",
      `discussion ${discussionId}`,
    );
  return comment;
}
async function reply(discussionId, parentId, body) {
  const mutation =
    "mutation($discussion:ID!,$parent:ID!,$body:String!){addDiscussionComment(input:{discussionId:$discussion,replyToId:$parent,body:$body}){comment{id url}}}";
  const result = await json(
    query(mutation).concat(["-f", `discussion=${discussionId}`, "-f", `parent=${parentId}`, "-f", `body=${body}`]),
    "reply to discussion comment",
    `discussion ${discussionId}`,
  );
  const comment = result.data?.addDiscussionComment?.comment;
  if (!comment)
    throw githubError(
      new Error("resource is unavailable, closed, or state-conflicted"),
      "reply to discussion comment",
      `discussion ${discussionId}`,
    );
  return comment;
}
async function comments(owner, repo, number) {
  const source =
    "query($owner:String!,$repo:String!,$number:Int!,$after:String){repository(owner:$owner,name:$repo){discussion(number:$number){comments(first:100,after:$after){nodes{id body author{login} replies(first:100){nodes{id body author{login}}}} pageInfo{hasNextPage endCursor}}}}}}";
  const resource = `${owner}/${repo}#${number}`;
  const all = [];
  let after;
  do {
    const args = query(source).concat(
      ["-f", `owner=${owner}`, "-f", `repo=${repo}`, "-F", `number=${number}`],
      after ? ["-f", `after=${after}`] : [],
    );
    const result = await json(args, "poll discussion comments", resource);
    const discussion = result.data?.repository?.discussion;
    if (!discussion)
      throw githubError(
        new Error("resource is unavailable, closed, or state-conflicted"),
        "poll discussion comments",
        resource,
      );
    all.push(...discussion.comments.nodes.flatMap((comment) => [comment, ...(comment.replies.nodes || [])]));
    const pageInfo = discussion.comments.pageInfo;
    after = pageInfo?.hasNextPage ? pageInfo.endCursor : undefined;
  } while (after);
  return all;
}

function render(message, handle) {
  const mention = message.replyTo ? "" : `@${handle(message.to)}\n\n`;
  return `${mention}${truncateForDiscussion(message.message)}\n\n${handle(message.from)}\n\n<!-- comm:${message.id} -->`;
}

export async function startGithubDiscussionAdapter(controller, config) {
  let state;
  try {
    state = JSON.parse(await readFile(config.stateFile, "utf8"));
  } catch {
    const repo = await repository();
    state = { ...(await discussion({ ...repo, ...config })), ...repo, seen: [] };
    await writeFile(config.stateFile, JSON.stringify(state, null, 2));
  }
  const parents = new Map();
  const handles = new Map(Object.entries(config.recipients).map(([name, id]) => [id, name]));
  const handle = (id) => handles.get(id) ?? id;
  const recipient = (name) => config.recipients[name];
  const seen = new Set(state.seen || []);
  let recentDigests = state.recentPostDigests || [];
  let writes = Promise.resolve();
  const unsubscribe = controller.subscribe((message) => {
    writes = writes.then(async () => {
      if (message.from === "human:github-discussion") return;
      if (!message.replyTo) {
        const digest = contentDigest(message.to, message.message);
        if (recentDigests.includes(digest)) return;
        recentDigests = withRecentDigest(recentDigests, digest);
        state.recentPostDigests = recentDigests;
        await writeFile(config.stateFile, JSON.stringify(state, null, 2));
      }
      const parent = message.replyTo && parents.get(message.replyTo);
      const body = render(message, handle);
      const comment = parent ? await reply(state.id, parent, body) : await post(state.id, body);
      if (message.kind === "request") parents.set(message.id, comment.id);
    });
    return writes;
  });
  const poll = async () => {
    for (const comment of await comments(state.owner, state.repo, state.number)) {
      if (seen.has(comment.id) || comment.body.includes("<!-- comm:")) continue;
      seen.add(comment.id);
      const match = comment.body.match(/^@([\w-]+)/);
      const to = recipient(match?.[1]) ?? config.lead;
      const body = match ? comment.body.slice(match[0].length).trim() : comment.body;
      const accepted = controller.injectHuman({ to, body, author: comment.author?.login, externalId: comment.id });
      parents.set(accepted.id, comment.id);
    }
    state.seen = [...seen].slice(-500);
    await writeFile(config.stateFile, JSON.stringify(state, null, 2));
  };
  await poll().catch((error) => {
    if (!error.transient) throw error;
  });
  const timer = setInterval(() => poll().catch(() => {}), config.pollIntervalMs ?? 5000);
  return {
    stop: async () => {
      clearInterval(timer);
      unsubscribe();
      await writes;
      await poll().catch(() => {});
    },
  };
}
