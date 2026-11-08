export function scanForSecret(token, { workspaceTar, seedArchive, runRecords }) {
  const found = [];
  if (workspaceTar.includes(token)) found.push("workspaceTar");
  if (seedArchive.includes(token)) found.push("seedArchive");
  if (JSON.stringify(runRecords).includes(token)) found.push("runRecords");
  return found;
}
