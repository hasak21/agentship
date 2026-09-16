# Bootstrap local evidence review

## Objective

Create the first local, deterministic AgentShip review path without depending on the Next.js server or an LLM.

## Requirements

1. A developer can run the review from the repository with one command.
2. AgentShip executes checks itself rather than accepting an agent's claim that they passed.
3. The report binds the Git state, task, configuration, commands, results, and timing.
4. Report mode records blockers without failing the shell command; gate mode fails on blockers.
5. The existing web application remains functional.

## Out of scope

- Hostile pull-request isolation
- LLM-assisted intent comparison
- Signed attestations
- Hosted report storage
