// Hermetic: the host's real dependency-source preparation downloads from the npm registry when its cache is cold.
export default {
  prepareDependencySources: async () => ({ failures: [] }),
  preflight: async () => {},
  createModelRuntime: async () => ({}),
  createMemberAgent: async () => ({
    run: { prompt: async () => ({ status: "completed", finalText: "" }), abort: async () => {} },
    verify: () => new Promise(() => {}),
    dispose: () => new Promise(() => {}),
  }),
};
