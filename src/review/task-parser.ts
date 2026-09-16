export interface TaskRequirement {
  id: string;
  text: string;
  line: number;
  confirmation: "explicit";
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
    requirements.push({
      id: `R${match[1]}`,
      text: match[2],
      line: index + 1,
      confirmation: "explicit",
    });
  }

  return requirements;
}
