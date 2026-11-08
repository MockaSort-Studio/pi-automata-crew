import { Type } from "typebox";

// How an agent asks for what it cannot get itself. The runner records the question and ends the run, so
// "blocked" is an observed fact (this tool was called) and not a state the model has to declare correctly.
export function createRequestInputTool({ onRequest }) {
  return {
    name: "request_input",
    label: "Request input",
    description:
      "Ask the person coordinating this work for something you cannot get yourself: new authority or credentials, a security or scope decision, a forbidden file or class, or evidence unobtainable with your granted tools. Do NOT use it for routine implementation choices, updating tests that contradict your assignment, touching supporting files, or picking between equivalent approaches: decide those and record why in the PR. Ends your turn; the answer arrives as your next message.",
    parameters: Type.Object({ question: Type.String({ minLength: 1, maxLength: 4000 }) }),
    async execute(_id, input) {
      onRequest({ question: String(input.question) });
      return {
        content: [{ type: "text", text: "Question recorded. Stop now; the answer will arrive as your next message." }],
        details: {},
      };
    },
  };
}
