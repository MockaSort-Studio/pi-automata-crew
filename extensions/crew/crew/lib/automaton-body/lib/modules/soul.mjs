export function soulModule(ctx) {
  const persona = ctx.persona;
  if (!persona?.intro || !persona?.tone || !persona?.voice || !persona?.signature)
    throw new Error("soulModule requires a complete persona");
  return {
    instructions: [
      "## PERSONA",
      persona.intro,
      `**Tone:** ${persona.tone}`,
      `**Voice:** ${persona.voice}`,
      `**Signature:** ${persona.signature}`,
    ].join("\n"),
    tools: [],
  };
}
