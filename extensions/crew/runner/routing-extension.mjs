import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { GUEST_WORKSPACE } from "../env-runtime/lib/gondolin-worker-paths.mjs";
import {
  editOperations,
  executeGrep,
  findOperations,
  lsOperations,
  readOperations,
  writeOperations,
} from "../env-runtime/lib/gondolin-worker-operations.mjs";
import { bashOperations } from "../env-runtime/lib/gondolin-worker-shell.mjs";
import { evaluateShellCommand } from "./shell-policy.mjs";

// Pi keeps the logic of its built-in tools (argument handling, truncation, diffs) on the host; this
// extension only replaces where they act: every command and file operation runs in the environment's VM.
// Schemas and descriptions come from Pi's own local tools, so the model sees the tools it expects.
export function routedToolsExtension(environment) {
  const { localCwd, withVm } = environment;
  const routed = (local, create) => ({
    ...local,
    execute: (id, params, signal, onUpdate) => withVm((vm) => create(vm).execute(id, params, signal, onUpdate)),
  });
  return (pi) => {
    pi.on("agent_start", () => environment.cancelIdle());
    pi.on("agent_settled", () => environment.armIdle());
    pi.registerTool(
      routed(createReadTool(localCwd), (vm) =>
        createReadTool(GUEST_WORKSPACE, { operations: readOperations(vm, localCwd) }),
      ),
    );
    pi.registerTool(
      routed(createWriteTool(localCwd), (vm) =>
        createWriteTool(GUEST_WORKSPACE, { operations: writeOperations(vm, localCwd) }),
      ),
    );
    pi.registerTool(
      routed(createEditTool(localCwd), (vm) =>
        createEditTool(GUEST_WORKSPACE, { operations: editOperations(vm, localCwd) }),
      ),
    );
    const bash = routed(createBashTool(localCwd), (vm) =>
      createBashTool(GUEST_WORKSPACE, { operations: bashOperations(vm, localCwd) }),
    );
    pi.registerTool({
      ...bash,
      execute: (id, params, signal, onUpdate) => {
        const rejection = evaluateShellCommand(params.command);
        if (rejection) return Promise.resolve({ content: [{ type: "text", text: rejection.message }], isError: true });
        return bash.execute(id, params, signal, onUpdate);
      },
    });
    pi.registerTool(
      routed(createLsTool(localCwd), (vm) => createLsTool(GUEST_WORKSPACE, { operations: lsOperations(vm, localCwd) })),
    );
    pi.registerTool(
      routed(createFindTool(localCwd), (vm) =>
        createFindTool(GUEST_WORKSPACE, { operations: findOperations(vm, localCwd) }),
      ),
    );
    pi.registerTool({
      ...createGrepTool(localCwd),
      execute: (_id, params, signal) => withVm((vm) => executeGrep(vm, localCwd, params, signal)),
    });
  };
}
