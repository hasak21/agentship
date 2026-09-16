export interface TaskRequirement {
  id: string;
  text: string;
  line: number;
  confirmation: "not_required" | "required" | "confirmed";
}

/** Extract numbered requirements from a Markdown `## Requirements` section. */
export function parseTaskRequirements(markdown: string): TaskRequirement[] {
  const lines = markdown.split(/\r?\n/);
  const requirements: TaskRequirement[] = [];
  let inRequirements = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) {
      const level = line.match(/^#+/)?.[0].length ?? 0;
      if (level <= 2) {
        inRequirements = heading[1].trim().toLowerCase() === "requirements";
      }
      continue;
    }

    if (!inRequirements) continue;
    const match = line.match(/^\s*(\d+)[.)]\s+(.+?)\s*$/);
    if (!match) continue;
    const requiresConfirmation = match[2].startsWith("[confirm]");
    requirements.push({
      id: `R${match[1]}`,
      text: requiresConfirmation
        ? match[2].slice("[confirm]".length).trim()
        : match[2],
      line: index + 1,
      confirmation: requiresConfirmation ? "required" : "not_required",
    });
  }

  return requirements;
}

export function applyRequirementConfirmations(
  requirements: TaskRequirement[],
  confirmedIds: string[]
): TaskRequirement[] {
  const knownIds = new Set(requirements.map((requirement) => requirement.id));
  const unknown = confirmedIds.filter((id) => !knownIds.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown requirement confirmation: ${unknown.join(", ")}.`);
  }
  const confirmed = new Set(confirmedIds);
  return requirements.map((requirement) => ({
    ...requirement,
    confirmation:
      requirement.confirmation === "required" && confirmed.has(requirement.id)
        ? "confirmed"
        : requirement.confirmation,
  }));
}
