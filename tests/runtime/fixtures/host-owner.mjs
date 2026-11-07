// Test fixture: a process that owns a crew host and a running crew, until it is killed.
import { createHostClient } from "../../../extensions/crew/runner/host-client.mjs";

const client = createHostClient({ env: process.env, onEvent: (event) => console.log("EVENT", JSON.stringify(event)) });
await client.request("launch", JSON.parse(process.env.CREW_TEST_LAUNCH));
console.log("LAUNCHED", client.pid);
setInterval(() => {}, 1000);
