import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppContext } from "../context.js";
import type { Store } from "../db.js";
import { runDir } from "../runner/trace.js";
import type { CriticScore, MatchState, Round, Tournament, Variant } from "../types.js";

export interface MatchView extends MatchState {
  scores: CriticScore[];
}

export interface BracketView {
  tournament: Tournament;
  variants: Variant[];
  matches: MatchView[];
  costUsd: number;
}

const TERMINAL = new Set(["crowned", "no_winner", "halted"]);

export function bracketView(store: Store, tournamentId: string): BracketView {
  const tournament = store.getTournament(tournamentId);
  return {
    tournament,
    variants: store.listVariants(tournamentId),
    matches: store.listMatches(tournamentId).map((m) => ({ ...m, scores: store.listScores(m.id) })),
    costUsd: store.totalCost(tournamentId),
  };
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ROUND_TITLES: Record<Round, string> = { r1: "Round 1", r2: "Semi-finals", final: "Final" };
const ROLE_LABEL = { brand: "Brand", performance: "Performance", compliance: "Compliance" } as const;

function entrant(view: BracketView, m: MatchView, side: "a" | "b"): string {
  const slot = m[side];
  if (slot === undefined) return `<div class="entrant tbd">Awaiting winner</div>`;
  if (slot === null) return `<div class="entrant empty">Empty slot</div>`;
  const v = view.variants.find((x) => x.id === slot);
  const r = m.resolution;
  const won = m.done && m.winner === slot;
  const lost = m.done && !won;
  const dq = r ? (side === "a" ? r.dqA : r.dqB) : false;
  const total = r ? (side === "a" ? r.wA : r.wB) : null;
  const cls = ["entrant", won ? "won" : "", lost ? "lost" : ""].filter(Boolean).join(" ");
  return `<div class="${cls}">
    <div class="ent-main">
      <span class="angle">${esc(v?.angle)}</span>
      <span class="headline">${esc(v?.headline)}</span>
    </div>
    <div class="ent-side">
      ${dq ? `<span class="badge dq">DQ</span>` : ""}
      ${total !== null ? `<span class="total">${total.toFixed(2)}</span>` : ""}
    </div>
  </div>`;
}

function scoreTable(m: MatchView): string {
  if (m.scores.length === 0) return "";
  const rows = m.scores
    .map(
      (s) => `<tr>
        <td>${ROLE_LABEL[s.role]}${m.round === "final" ? ` <span class="ord">${s.order === "ab" ? "A→B" : "B→A"}</span>` : ""}</td>
        <td class="num">${s.abstained ? "–" : esc(s.scoreA)}</td>
        <td class="num">${s.abstained ? "–" : esc(s.scoreB)}</td>
        <td>${s.abstained ? `<em>abstained</em>` : esc(s.rationale)}</td>
      </tr>`,
    )
    .join("");
  return `<details><summary>Scores and rationales</summary>
    <table><thead><tr><th>Critic</th><th>A</th><th>B</th><th>Rationale</th></tr></thead><tbody>${rows}</tbody></table>
  </details>`;
}

function matchNote(m: MatchView): string {
  const r = m.resolution;
  if (!r) return m.scores.length ? `<div class="note live">Judging…</div>` : "";
  const notes: string[] = [];
  if (r.kind === "walkover") notes.push("Walkover");
  if (r.kind === "empty") notes.push("No entrants");
  if (r.kind === "double_dq") notes.push("Both disqualified");
  if (r.abstained.length) notes.push(`Abstained: ${r.abstained.join(", ")}`);
  if (r.tiebreak) notes.push(`Tie-break → ${r.tiebreak.winnerSide.toUpperCase()}: ${esc(r.tiebreak.rationale)}`);
  if (r.swap) {
    const show = (x: "a" | "b" | null) => (x ? x.toUpperCase() : "tie");
    const flipped = r.swap.ab && r.swap.ba && r.swap.ab !== r.swap.ba;
    notes.push(`Swap check: A→B picked ${show(r.swap.ab)}, B→A picked ${show(r.swap.ba)}${flipped ? " (position flip, averaged)" : ""}`);
  }
  return notes.length ? `<div class="note">${notes.join(" · ")}</div>` : "";
}

function matchCard(view: BracketView, m: MatchView): string {
  return `<article class="match">
    ${entrant(view, m, "a")}
    ${entrant(view, m, "b")}
    ${matchNote(m)}
    ${scoreTable(m)}
  </article>`;
}

function championCard(view: BracketView): string {
  const t = view.tournament;
  const finalM = view.matches.find((m) => m.round === "final");
  if (t.status === "crowned" && t.crown) {
    const v = view.variants.find((x) => x.id === t.crown!.winnerId);
    return `<article class="champion">
      <div class="trophy">Champion</div>
      <div class="headline">${esc(v?.headline)}</div>
      <p class="hook">${esc(v?.hook)}</p>
      <p class="meta">${t.crown.by === "human" ? "Crowned by a human" : "Auto-crowned (panel pick)"}</p>
    </article>`;
  }
  if (t.status === "awaiting_human" && finalM?.winner) {
    const v = view.variants.find((x) => x.id === finalM.winner);
    return `<article class="champion pending"><div class="trophy">Awaiting human pick</div><p class="meta">Panel favours: ${esc(v?.headline)}</p></article>`;
  }
  if (t.status === "no_winner") return `<article class="champion pending"><div class="trophy">No winner</div></article>`;
  return `<article class="champion pending"><div class="trophy">Champion</div><p class="meta">To be decided</p></article>`;
}

export function renderHtml(view: BracketView): string {
  const t = view.tournament;
  const live = !TERMINAL.has(t.status);
  const columns = (["r1", "r2", "final"] as Round[])
    .map(
      (round) => `<section class="col col-${round}">
        <h2>${ROUND_TITLES[round]}</h2>
        <div class="stack">${view.matches
          .filter((m) => m.round === round)
          .map((m) => matchCard(view, m))
          .join("")}</div>
      </section>`,
    )
    .join("");
  const halted = t.status === "halted" ? `<div class="halt">Halted: ${esc(t.haltReason)}. Resume with POST /tournaments/${esc(t.id)}/resume.</div>` : "";
  const pending =
    view.matches.length === 0
      ? `<p class="empty-state">${t.status === "generating" ? `Generating variants… ${view.variants.length}/8 saved.` : "No bracket yet."}</p>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${live ? `<meta http-equiv="refresh" content="3">` : ""}
<title>Creative tournament ${esc(t.id)}</title>
<style>
:root {
  --bg: #f7f5f0; --panel: #ffffff; --ink: #14213d; --muted: #6b7280; --line: #e5e1d8;
  --accent: #f28c28; --won: #e8f4ec; --won-ink: #1f7a45; --dq: #c0392b; --chip: #efece4;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #0f1420; --panel: #171e2e; --ink: #e8ecf4; --muted: #95a0b5; --line: #273049;
    --accent: #f5a04a; --won: #16301f; --won-ink: #6fd39a; --dq: #ff7a6b; --chip: #222b40; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
header { padding: 24px 24px 8px; max-width: 1400px; margin: 0 auto; }
h1 { margin: 0 0 6px; font-size: 22px; letter-spacing: -0.01em; }
.brief { color: var(--muted); max-width: 900px; margin: 0; }
.meta-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.chip { background: var(--chip); border-radius: 999px; padding: 3px 10px; font-size: 12px; }
.chip.status { background: var(--accent); color: #1b1b1b; font-weight: 600; }
.halt { margin: 12px 24px 0; padding: 10px 14px; border-left: 4px solid var(--dq); background: var(--panel); }
main { display: grid; grid-template-columns: repeat(3, minmax(260px, 1fr)) minmax(220px, 0.8fr); gap: 20px; padding: 20px 24px 40px; max-width: 1400px; margin: 0 auto; align-items: start; }
.col h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 0 0 10px; }
.stack { display: flex; flex-direction: column; gap: 14px; justify-content: space-around; }
.col-r2 .stack { padding-top: 70px; gap: 150px; }
.col-final .stack { padding-top: 210px; }
.match { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
.entrant { display: flex; justify-content: space-between; gap: 10px; padding: 9px 12px; border-bottom: 1px solid var(--line); }
.entrant.won { background: var(--won); box-shadow: inset 3px 0 0 var(--won-ink); }
.entrant.lost .headline { color: var(--muted); }
.entrant.tbd, .entrant.empty { color: var(--muted); font-style: italic; }
.ent-main { display: flex; flex-direction: column; min-width: 0; }
.angle { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.headline { font-weight: 600; }
.ent-side { display: flex; align-items: center; gap: 6px; }
.total { font-variant-numeric: tabular-nums; font-weight: 600; }
.badge.dq { background: var(--dq); color: #fff; border-radius: 4px; padding: 1px 6px; font-size: 11px; font-weight: 700; }
.note { padding: 8px 12px; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--line); }
.note.live { color: var(--accent); }
details { padding: 6px 12px 10px; }
summary { cursor: pointer; font-size: 12px; color: var(--muted); }
table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 12px; }
th, td { text-align: left; padding: 4px 6px; border-top: 1px solid var(--line); vertical-align: top; }
td.num { font-variant-numeric: tabular-nums; width: 28px; }
.ord { color: var(--muted); font-size: 10px; }
.champion { background: var(--panel); border: 2px solid var(--accent); border-radius: 12px; padding: 16px; margin-top: 230px; }
.champion.pending { border-style: dashed; border-color: var(--line); }
.trophy { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); font-weight: 700; }
.champion .headline { font-size: 18px; margin-top: 6px; }
.hook { margin: 6px 0; }
.champion .meta { color: var(--muted); font-size: 12px; margin: 0; }
.empty-state { color: var(--muted); padding: 0 24px; max-width: 1400px; margin: 20px auto; }
@media (max-width: 900px) {
  main { grid-template-columns: 1fr; }
  .col-r2 .stack, .col-final .stack { padding-top: 0; gap: 14px; }
  .champion { margin-top: 0; }
}
</style>
</head>
<body>
<header>
  <h1>Creative tournament <span style="color:var(--muted)">${esc(t.id)}</span></h1>
  <p class="brief">${esc(t.brief.brief)}</p>
  <div class="meta-row">
    <span class="chip status">${esc(t.status.replace("_", " "))}</span>
    <span class="chip">${esc(t.brief.channels.join(" · "))}</span>
    <span class="chip">Cost $${view.costUsd.toFixed(3)}</span>
    <span class="chip">Seed: ${esc(t.seedStrategy)}</span>
  </div>
</header>
${halted}
${pending}
${view.matches.length ? `<main>${columns}<section class="col"><h2>Champion</h2>${championCard(view)}</section></main>` : ""}
</body>
</html>
`;
}

export function renderToDisk(ctx: Pick<AppContext, "store" | "config">, tournamentId: string): string {
  const path = join(runDir(ctx.config.runsDir, tournamentId), "bracket.html");
  writeFileSync(path, renderHtml(bracketView(ctx.store, tournamentId)));
  return path;
}
