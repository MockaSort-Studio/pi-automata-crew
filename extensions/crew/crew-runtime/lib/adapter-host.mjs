import { startGithubDiscussionAdapter } from "./github-discussion.mjs";

const factories = {
  "github-discussion": startGithubDiscussionAdapter,
};

export async function startAdapters(controller, configs = []) {
  const adapters = await Promise.all(
    configs.map(async (config) => {
      const factory = factories[config.id];
      if (!factory) throw new Error(`Unknown Comm adapter: ${config.id}`);
      return factory(controller, config);
    }),
  );
  return async () => Promise.allSettled(adapters.map((adapter) => adapter.stop()));
}
