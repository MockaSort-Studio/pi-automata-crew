export default {
  createModelRuntime: () => {
    process.stderr.write("runtime pending\n");
    return new Promise(() => {});
  },
};
