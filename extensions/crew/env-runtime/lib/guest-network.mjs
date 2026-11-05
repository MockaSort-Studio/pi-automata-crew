import { createHttpHooks } from "@earendil-works/gondolin";

const MAX_DENIED_HOSTS = 20;

// HTTP hooks enforce the host policy after DNS resolution. Record each denied
// host once, bounded, so a broken worker is diagnosable without logging requests.
export function createGuestNetwork({ allowedHosts = [], secrets = {}, onDenied = () => {} } = {}) {
  const network = createHttpHooks({ allowedHosts, secrets });
  const allowIp = network.httpHooks.isIpAllowed;
  const deniedHosts = new Set();
  network.httpHooks.isIpAllowed = async (info) => {
    const allowed = await allowIp(info);
    if (!allowed && deniedHosts.size < MAX_DENIED_HOSTS && !deniedHosts.has(info.hostname)) {
      deniedHosts.add(info.hostname);
      onDenied(info.hostname);
    }
    return allowed;
  };
  return network;
}
