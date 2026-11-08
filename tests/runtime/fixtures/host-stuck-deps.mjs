export default {
  createModelRuntime: async () => ({}),
  createMemberAgent: async () => ({
    run: { prompt: async () => ({ status: "completed", finalText: "" }), abort: async () => {} },
    verify: () => new Promise(() => {}),
    dispose: () => new Promise(() => {}),
  }),
};
