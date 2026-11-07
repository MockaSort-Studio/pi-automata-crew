import http from "node:http";

const chunk = (id, delta, finish = null) =>
  `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model: "mock-model", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

// Offline OpenAI-compatible model. `respond(callNumber, requestBody)` returns one of
// { toolCall: { name, arguments } }, { text }, { empty: true } or { status, body } (an HTTP failure). Every request body is kept in `server.requests`.
export function mockModel(respond) {
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (data) => (body += data));
    request.on("end", () => {
      server.requests.push(body);
      const id = `mock-${server.requests.length}`;
      const reply = respond(server.requests.length, body);
      // { status, body } models a provider failure (for example 429); { empty: true } a turn with no output.
      if (reply.status) {
        response.writeHead(reply.status, { "content-type": "application/json" });
        return response.end(reply.body ?? "{}");
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      if (reply.empty) response.write(chunk(id, { role: "assistant" }) + chunk(id, {}, "stop"));
      else if (reply.toolCall) {
        const call = { index: 0, id: `call_${server.requests.length}`, type: "function", function: reply.toolCall };
        response.write(chunk(id, { role: "assistant", tool_calls: [call] }) + chunk(id, {}, "tool_calls"));
      } else response.write(chunk(id, { role: "assistant", content: reply.text }) + chunk(id, {}, "stop"));
      response.end("data: [DONE]\n\n");
    });
  });
  server.requests = [];
  return server;
}

export const providerFor = (server) => ({
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
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
