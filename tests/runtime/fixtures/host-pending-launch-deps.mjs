// Hermetic: the host's real dependency-source preparation downloads from the npm registry when its cache is cold.
export default {
  prepareDependencySources: async () => ({ failures: [] }),
  preflight: async () => {},
  createModelRuntime: () => {
    process.stderr.write("runtime pending\n");
    return new Promise(() => {});
  },
};
