const PROFILE_FORMAT = "hall.crew-profile/v1";

const strings = (value, label) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item))
    throw new Error(`Crew profile ${label} must be non-empty strings`);
  return [...new Set(value)];
};

const suiteIndex = (suites) => {
  const byTool = new Map();
  for (const suite of suites ?? []) {
    if (!suite?.suite || !Array.isArray(suite.tools)) throw new Error("Crew profile has an invalid Armory suite");
    for (const tool of strings(suite.tools, `tools for ${suite.suite}`)) {
      if (byTool.has(tool)) throw new Error(`Crew profile maps ${tool} to multiple Armory suites`);
      byTool.set(tool, suite.suite);
    }
  }
  return byTool;
};

// `actor.tools` is Crew's policy source. Armory supplies suite descriptors
// before launch; any granted tool absent from those descriptors is a normal Pi
// guest operation. Comm tools are deliberately not part of the guest profile.
export function compileActorProfile({ tools, commTools = [], suites = [] }) {
  const granted = strings(tools, "tools");
  const comm = new Set(strings(commTools, "Comm tools"));
  const suiteFor = suiteIndex(suites);
  const selected = new Map();
  const builtins = [];
  for (const tool of granted) {
    const suite = suiteFor.get(tool);
    if (!suite) builtins.push(tool);
    else selected.set(suite, [...(selected.get(suite) ?? []), tool]);
  }
  return {
    format: PROFILE_FORMAT,
    tools: granted,
    commTools: [...comm],
    builtins,
    suites: [...selected].map(([suite, selectedTools]) => ({ suite, tools: selectedTools })),
  };
}
