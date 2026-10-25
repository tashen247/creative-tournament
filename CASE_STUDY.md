# Case study: creative-tournament

*Tashen Muthayan · Tash Tech Solutions R&D*

## Problem

Creative teams make dozens of ad variants and then have to choose. The usual options are gut feel, which is fast but unaccountable, or live A/B tests, which are accountable but cost media spend and weeks. I wanted to see whether a panel of AI judges could sit in between: cheap enough to run on every batch, and transparent enough that a creative lead could see *why* something won and overrule it.

The catch is that LLM judges have well-known failure modes. They prefer whichever option they read first. They don't always agree with themselves. And if one model both writes and judges, or one judge sees the others' scores, you get a confident-sounding consensus that doesn't mean much.

## Design

I split the work so no single model call can decide an outcome on its own.

- **A separate generator and judges.** One agent writes eight variants from different angles. Different agents, with different prompts and a cheaper model, judge them.
- **Critics that are blind by construction.** Each critic sees the brief, the brand guide and the two ads in front of it. Nothing else. That isn't a prompt instruction; the runner builds every prompt from the database, and the function that builds it has no parameter a score could travel through. Each critic's only tool is created for that one call and bound to its match, role and presentation order.
- **A deterministic referee.** The models submit scores. A pure TypeScript state machine applies the weights, the compliance disqualification, the tie-break rule and the bracket advancement. The model never decides a winner directly.
- **A human with the final veto.** The two finalists go to Slack. One click crowns the winner. If nobody answers, the panel's pick stands and is marked as auto-crowned.

### Why I removed the orchestrator

The first version of the spec had an orchestrator agent coordinating subagents. When I worked through it, the orchestrator never made a decision that code couldn't make better: the flow is fixed and every winner is computed. It would have cost turns and money and added a way for the run to drift. So the runner is plain code, and each agent is a separate, tightly scoped `query()` call. Agents are used where judgement is needed and nowhere else.

## Engineering

- **Idempotent, resumable state machine.** Tournaments, variants, matches and scores live in SQLite. After a halt or a crash, resume re-enters at the first unfinished step. Finished matches are never re-judged; partial scores for the interrupted match are thrown away and collected again. Crowning is idempotent too: a double-clicked Slack button or an n8n retry gets the existing result back.
- **Fail closed on compliance.** A brand or performance critic that can't produce a valid score may abstain, and the weights renormalise. The compliance critic may not. It gets one fresh call, and if that fails the tournament halts rather than let an unchecked ad advance.
- **Two layers of compliance.** A banned-claims regex rejects explicit promises at save time, every time. The compliance critic is there for what regex can't see, like an *implied* guarantee. The evals test each layer separately.
- **Cheap models for volume.** About 25 calls per tournament, almost all of them small Haiku critic calls. A cumulative budget guard estimates each call before making it and halts before the cap rather than after.
- **Everything traced.** Every agent call writes a JSONL line with its role, match, presentation order, attempt, turns, cost and outcome. The bracket page shows every score and rationale.
- **Tests without the model.** The unit tests swap the SDK for a stub that drives the real tool handlers, including invalid submissions, so the runner, tools, bracket and API are all exercised in CI without a model call.

## Findings and results

Live eval results to follow. The harness is in place: `npm run evals` measures the planted-variant disqualification rate, critic consistency, the position-bias flip rate before and after swap-averaging, and cost per tournament. `npm run evals -- --dry` checks the wiring for free, and CI runs it on every push.
