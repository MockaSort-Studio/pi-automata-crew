const NL = String.fromCharCode(10);
export function createRobot() {
  const installed = [];
  const robot = {
    install: function (module, context = {}) {
      installed.push({ module, context });
      return this;
    },
    build: function () {
      const fragments = [];
      const tools = [],
        commTools = [],
        extensionPaths = [];
      let model, thinking;
      for (const { module, context } of installed) {
        const f = module(context);
        if (f.instructions) fragments.push(f.instructions);
        if (f.tools) f.tools.forEach((t) => !tools.includes(t) && tools.push(t));
        if (f.commTools) f.commTools.forEach((t) => !commTools.includes(t) && commTools.push(t));
        if (f.extensionPaths)
          f.extensionPaths.forEach((path) => !extensionPaths.includes(path) && extensionPaths.push(path));
        if (f.model !== undefined) model = f.model;
        if (f.thinking !== undefined) thinking = f.thinking;
      }
      return {
        instructions: fragments.join(NL + NL + "---" + NL + NL),
        tools,
        commTools,
        extensionPaths,
        model,
        thinking,
      };
    },
  };
  return robot;
}
