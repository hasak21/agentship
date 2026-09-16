# Detect repository mutation during review

## Objective

Prevent checks from producing a passing report for repository state different from the state AgentShip originally reviewed.

## Requirements

1. Capture the Git head and reviewed diff digest before executing checks.
2. Capture the same repository evidence after all checks finish.
3. A changed head or diff digest produces a blocker finding.
4. JSON evidence contains both states and an explicit stability result.
5. The Markdown report displays whether repository state remained stable.
6. Regression coverage proves mutation findings cannot produce PASS.
