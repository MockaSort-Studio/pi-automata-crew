const port = Number(process.env.HALL_TEST_MOCK_MODEL_PORT);

export default (pi) =>
  pi.registerProvider("mock", {
    baseUrl: `http://127.0.0.1:${port}/v1`,
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
