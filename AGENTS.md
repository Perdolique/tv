# Repository instructions

## Package management

- Use `vp` for package manager commands run locally by users, agents, and Git hooks.

## UI implementation

- Read `apps/web/DESIGN.md` before changing UI, styling, themes, or responsive behavior.
- Treat its semantic tokens and component rules as the design source of truth.

## Verification

- Run applicable checks in parallel where practical.
- During development, run only focused checks for the code changed. Do not run full suites manually unless the user explicitly asks; commit hooks run the mandatory verification suite.
- If you are creating a commit, do not run the mandatory verification suite manually first; commit hooks will run it.
- Pass changed file paths to test and lint commands when supported; otherwise use the narrowest applicable focused command.

### Markdown file changes

- Do not hard-wrap Markdown prose or list items; keep each semantic paragraph or item on a single source line and let renderers handle visual wrapping.
- `vp run lint:markdown`.

### TypeScript or Vue file changes

- `vp run format`.
- `vp run test:typecheck`.
- `vp run test:unit`.
- `vp run lint:oxlint`.

### Playwright test or tested flow changes

- Run affected test files with `vp run test:e2e <file>`.
- Use `vp run test:e2e --grep "<test name>"` when only specific scenarios are affected.
- Do not run the whole end-to-end test suite unless explicitly asked.

## GitHub planning

- When asked to create an epic or planned work item, create it on GitHub in simple English with a clear title and short `Goal` and `Acceptance criteria` sections; add a `Not included` section when it helps clarify the scope; then add the item to the repository project and set the appropriate `Level`, `Status`, and milestone.
- Treat issues labeled `idea` as exploratory notes rather than planned work: describe the idea concisely without requiring `Goal` or `Acceptance criteria`, add it to the repository project with the appropriate `Level`, `Backlog` status, and the `Future` milestone, and do not invent a solution while the product direction is undecided.
