export const skipLiveGondolin = (t) => {
  if (process.env.HALL_SKIP_GONDOLIN_LIVE_TESTS !== "1") return false;
  t.skip("live Gondolin VM tests are disabled on this runner");
  return true;
};
