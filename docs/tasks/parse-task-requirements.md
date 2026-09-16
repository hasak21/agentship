# Parse explicit task requirements

## Objective

Create the deterministic input layer for intent-to-diff verification by extracting explicit requirements from the task document.

## Requirements

1. Parse numbered items only from a Markdown `Requirements` section.
2. Assign stable requirement identifiers and retain source line numbers.
3. Bind parsed requirements into the JSON evidence manifest.
4. Display parsed requirements in the Markdown verification report.
5. Do not infer missing requirements or treat unrelated numbered lists as requirements.
6. Add deterministic regression coverage for extraction and section boundaries.

## Out of scope

- LLM-assisted requirement discovery
- Requirement-to-code mapping
- Ambiguity classification
