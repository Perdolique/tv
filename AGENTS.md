# Repository instructions

## Package management

- Use `vp` for package manager commands run locally by users, agents, and Git hooks.

## Cost awareness

The project is intentionally cost-conscious. Treat cost as useful implementation context, not as a requirement to compromise correctness or user experience. When a change could materially increase metered usage, identify any practical technical limits or cheaper designs and present the relevant options, benefits, and trade-offs to the user. Let the user choose before implementing a cost-control measure.

The prices and allowances below were verified on 2026-08-24. Check the linked official pricing before relying on them because providers can change their terms.

- [Cloudflare Workers Paid](https://developers.cloudflare.com/workers/platform/pricing/): $5 minimum per account per month includes 10 million requests and 30 million CPU milliseconds; overage is $0.30 per million requests and $0.02 per million CPU milliseconds. Static asset requests are free. Service Binding calls add no request charge, but CPU across both Workers is billed together.
- [Cloudflare Email Sending](https://developers.cloudflare.com/email-service/platform/pricing/): 3,000 outbound emails per account per billing month are included with Workers Paid; overage is $0.35 per 1,000 emails. Production and staging share this allowance.
- [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/): 20 million log events per account per month are included with Workers Paid; overage is $0.60 per million events. Production and staging currently use a `head_sampling_rate` of `1`.
- [Cloudflare Hyperdrive](https://developers.cloudflare.com/hyperdrive/platform/pricing/): unlimited database queries, connection pooling, query caching, and data transfer are included with Workers Paid without a separate usage charge. The underlying Neon database has its own limits.
- [Cloudflare Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/): the binding has no separately documented usage price; its Worker request and CPU usage remains covered by the Workers allowance and overage rates above.
- [Neon Free](https://neon.com/pricing): each project includes 100 CU-hours per month, 0.5 GB of storage, up to 10 branches, and compute sizes up to 2 CU. The Free plan does not bill overages; usage is limited until reset or upgrade. Production and staging are separate branches and consume the same project's allowances when they belong to the same project.
- [HIBP Pwned Passwords](https://haveibeenpwned.com/API/v3#PwnedPasswords): the range API used by authentication is free and requires no subscription or API key.
- [GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions): standard GitHub-hosted runners are free for this public repository. Artifact storage includes 500 MB on GitHub Free or 1 GB on GitHub Pro, then costs $0.25 per GB-month; Actions cache storage includes 10 GB per repository, then costs $0.07 per GB-month.

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
