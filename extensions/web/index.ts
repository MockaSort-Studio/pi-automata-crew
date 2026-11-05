import { Type } from "typebox";
import { webFetch } from "./lib.mjs";

export default function (pi) {
  pi.registerTool({
    name: "web_fetch",
    label: "Web: fetch",
    description: "Fetch bounded readable web content for research.",
    parameters: Type.Object({
      url: Type.String(),
      maxChars: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000 })),
    }),
    async execute(_id, input) {
      const value = await webFetch(input.url, input.maxChars);
      return { content: [{ type: "text", text: JSON.stringify(value) }], details: value };
    },
  });
}
