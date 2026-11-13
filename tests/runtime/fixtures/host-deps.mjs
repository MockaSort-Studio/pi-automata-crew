// Test seam for the crew host process: registers the offline mock provider in the host's model runtime.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

// Hermetic: the host's real dependency-source preparation downloads from the npm registry when its cache is cold.
export default {
  prepareDependencySources: async () => ({ failures: [] }),
  async createModelRuntime() {
    const dir = mkdtempSync(join(tmpdir(), "host-deps-"));
    const runtime = await ModelRuntime.create({
      authPath: join(dir, "auth.json"),
      modelsPath: join(dir, "models.json"),
    });
    runtime.registerProvider("mock", {
      baseUrl: process.env.CREW_TEST_MOCK_URL,
      apiKey: "mock-key",
      api: "openai-completions",
      models: [
        {
          id: "mock-model",
          name: "Mock",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 4096,
        },
      ],
    });
    return runtime;
  },
};
