import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Brief,
  CriticRole,
  CriticScore,
  CrownRecord,
  HaltReason,
  MatchState,
  Order,
  Resolution,
  Round,
  SeedStrategy,
  Slot,
  Tournament,
  TournamentStatus,
  Variant,
  VariantInput,
} from "./types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY,
  brief_json TEXT NOT NULL,
  status TEXT NOT NULL,
  halt_reason TEXT,
  halted_from TEXT,
  seed_strategy TEXT NOT NULL,
  seed INTEGER NOT NULL,
  resume_url TEXT,
  crown_json TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS variants (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  seq INTEGER NOT NULL,
  angle TEXT NOT NULL,
  hook TEXT NOT NULL,
  primary_text TEXT NOT NULL,
  headline TEXT NOT NULL,
  cta TEXT NOT NULL,
  visual_prompt TEXT NOT NULL,
  UNIQUE (tournament_id, seq)
);
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  round TEXT NOT NULL,
  idx INTEGER NOT NULL,
  a_state TEXT NOT NULL, -- unknown | empty | filled
  a_id TEXT,
  b_state TEXT NOT NULL,
  b_id TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  winner_id TEXT,
  resolution_json TEXT
);
CREATE TABLE IF NOT EXISTS scores (
  match_id TEXT NOT NULL REFERENCES matches(id),
  role TEXT NOT NULL,
  ord TEXT NOT NULL,
  abstained INTEGER NOT NULL,
  score_a REAL,
  score_b REAL,
  rationale TEXT,
  PRIMARY KEY (match_id, role, ord)
);
CREATE TABLE IF NOT EXISTS tiebreaks (
  match_id TEXT PRIMARY KEY REFERENCES matches(id),
  winner_side TEXT NOT NULL,
  rationale TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS costs (
  tournament_id TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  round TEXT,
  match_id TEXT,
  cost_usd REAL NOT NULL,
  at TEXT NOT NULL
);
`;

type Row = Record<string, unknown>;

function slotToCols(s: Slot): { state: string; id: string | null } {
  if (s === undefined) return { state: "unknown", id: null };
  if (s === null) return { state: "empty", id: null };
  return { state: "filled", id: s };
}

function colsToSlot(state: unknown, id: unknown): Slot {
  if (state === "unknown") return undefined;
  if (state === "empty") return null;
  return id as string;
}

export class Store {
  readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  tx<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // ---- tournaments -------------------------------------------------------

  createTournament(input: { brief: Brief; seedStrategy: SeedStrategy; seed?: number; resumeUrl?: string | null }): Tournament {
    const id = randomUUID().slice(0, 8);
    const seed = input.seed ?? Math.floor(Math.random() * 2 ** 31);
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO tournaments (id, brief_json, status, seed_strategy, seed, resume_url, created_at)
         VALUES (?, ?, 'generating', ?, ?, ?, ?)`,
      )
      .run(id, JSON.stringify(input.brief), input.seedStrategy, seed, input.resumeUrl ?? null, createdAt);
    return this.getTournament(id);
  }

  getTournament(id: string): Tournament {
    const r = this.db.prepare(`SELECT * FROM tournaments WHERE id = ?`).get(id) as Row | undefined;
    if (!r) throw new NotFoundError(`Tournament ${id} not found`);
    return {
      id: r.id as string,
      brief: JSON.parse(r.brief_json as string) as Brief,
      status: r.status as TournamentStatus,
      haltReason: (r.halt_reason as HaltReason | null) ?? null,
      haltedFrom: (r.halted_from as TournamentStatus | null) ?? null,
      seedStrategy: r.seed_strategy as SeedStrategy,
      seed: r.seed as number,
      resumeUrl: (r.resume_url as string | null) ?? null,
      crown: r.crown_json ? (JSON.parse(r.crown_json as string) as CrownRecord) : null,
      createdAt: r.created_at as string,
    };
  }

  hasTournament(id: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM tournaments WHERE id = ?`).get(id);
  }

  setStatus(id: string, status: TournamentStatus): void {
    this.db.prepare(`UPDATE tournaments SET status = ? WHERE id = ?`).run(status, id);
  }

  /** Compare-and-set; returns true if the row was in `from` and is now `to`. */
  transitionStatus(id: string, from: TournamentStatus, to: TournamentStatus): boolean {
    const res = this.db.prepare(`UPDATE tournaments SET status = ? WHERE id = ? AND status = ?`).run(to, id, from);
    return res.changes === 1;
  }

  halt(id: string, reason: HaltReason): void {
    const t = this.getTournament(id);
    if (t.status === "halted") return;
    this.db
      .prepare(`UPDATE tournaments SET status = 'halted', halt_reason = ?, halted_from = ? WHERE id = ?`)
      .run(reason, t.status, id);
  }

  /** Clear a halt and return to the status the run was in. */
  unhalt(id: string): TournamentStatus {
    const t = this.getTournament(id);
    if (t.status !== "halted" || !t.haltedFrom) return t.status;
    this.db
      .prepare(`UPDATE tournaments SET status = ?, halt_reason = NULL, halted_from = NULL WHERE id = ?`)
      .run(t.haltedFrom, id);
    return t.haltedFrom;
  }

  setResumeUrl(id: string, url: string | null): void {
    this.db.prepare(`UPDATE tournaments SET resume_url = ? WHERE id = ?`).run(url, id);
  }

  setCrown(id: string, crown: CrownRecord): void {
    this.db.prepare(`UPDATE tournaments SET crown_json = ?, status = 'crowned' WHERE id = ?`).run(JSON.stringify(crown), id);
  }

  // ---- variants ----------------------------------------------------------

  listVariants(tournamentId: string): Variant[] {
    const rows = this.db.prepare(`SELECT * FROM variants WHERE tournament_id = ? ORDER BY seq`).all(tournamentId) as Row[];
    return rows.map((r) => ({
      id: r.id as string,
      tournamentId: r.tournament_id as string,
      seq: r.seq as number,
      angle: r.angle as string,
      hook: r.hook as string,
      primaryText: r.primary_text as string,
      headline: r.headline as string,
      cta: r.cta as string,
      visualPrompt: r.visual_prompt as string,
    }));
  }

  getVariant(id: string): Variant {
    const r = this.db.prepare(`SELECT tournament_id FROM variants WHERE id = ?`).get(id) as Row | undefined;
    if (!r) throw new NotFoundError(`Variant ${id} not found`);
    const v = this.listVariants(r.tournament_id as string).find((x) => x.id === id);
    return v as Variant;
  }

  insertVariant(tournamentId: string, v: VariantInput): Variant {
    const seq = (this.db.prepare(`SELECT COUNT(*) AS n FROM variants WHERE tournament_id = ?`).get(tournamentId) as Row).n as number;
    const id = `${tournamentId}-v${seq + 1}`;
    this.db
      .prepare(
        `INSERT INTO variants (id, tournament_id, seq, angle, hook, primary_text, headline, cta, visual_prompt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, tournamentId, seq, v.angle, v.hook, v.primaryText, v.headline, v.cta, v.visualPrompt);
    return { ...v, id, tournamentId, seq };
  }

  // ---- matches -----------------------------------------------------------

  saveMatches(tournamentId: string, matches: MatchState[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO matches (id, tournament_id, round, idx, a_state, a_id, b_state, b_id, done, winner_id, resolution_json)
       VALUES (@id, @t, @round, @idx, @as, @aid, @bs, @bid, @done, @winner, @res)
       ON CONFLICT(id) DO UPDATE SET a_state=@as, a_id=@aid, b_state=@bs, b_id=@bid, done=@done,
         winner_id=@winner, resolution_json=@res`,
    );
    this.tx(() => {
      for (const m of matches) {
        const a = slotToCols(m.a);
        const b = slotToCols(m.b);
        stmt.run({
          id: m.id,
          t: tournamentId,
          round: m.round,
          idx: m.idx,
          as: a.state,
          aid: a.id,
          bs: b.state,
          bid: b.id,
          done: m.done ? 1 : 0,
          winner: m.winner,
          res: m.resolution ? JSON.stringify(m.resolution) : null,
        });
      }
    });
  }

  listMatches(tournamentId: string): MatchState[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM matches WHERE tournament_id = ?
         ORDER BY CASE round WHEN 'r1' THEN 0 WHEN 'r2' THEN 1 WHEN 'final' THEN 2 ELSE 3 END, idx`,
      )
      .all(tournamentId) as Row[];
    return rows.map((r) => ({
      id: r.id as string,
      round: r.round as Round,
      idx: r.idx as number,
      a: colsToSlot(r.a_state, r.a_id),
      b: colsToSlot(r.b_state, r.b_id),
      done: r.done === 1,
      winner: (r.winner_id as string | null) ?? null,
      resolution: r.resolution_json ? (JSON.parse(r.resolution_json as string) as Resolution) : null,
    }));
  }

  getMatch(id: string): MatchState & { tournamentId: string } {
    const r = this.db.prepare(`SELECT tournament_id FROM matches WHERE id = ?`).get(id) as Row | undefined;
    if (!r) throw new NotFoundError(`Match ${id} not found`);
    const tid = r.tournament_id as string;
    const m = this.listMatches(tid).find((x) => x.id === id) as MatchState;
    return { ...m, tournamentId: tid };
  }

  // ---- scores ------------------------------------------------------------

  hasScore(matchId: string, role: CriticRole, order: Order): boolean {
    return !!this.db.prepare(`SELECT 1 FROM scores WHERE match_id = ? AND role = ? AND ord = ?`).get(matchId, role, order);
  }

  saveScore(matchId: string, s: CriticScore): void {
    this.db
      .prepare(
        `INSERT INTO scores (match_id, role, ord, abstained, score_a, score_b, rationale)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(matchId, s.role, s.order, s.abstained ? 1 : 0, s.scoreA, s.scoreB, s.rationale);
  }

  listScores(matchId: string): CriticScore[] {
    const rows = this.db.prepare(`SELECT * FROM scores WHERE match_id = ? ORDER BY ord, role`).all(matchId) as Row[];
    return rows.map((r) => ({
      role: r.role as CriticRole,
      order: r.ord as Order,
      abstained: r.abstained === 1,
      scoreA: (r.score_a as number | null) ?? null,
      scoreB: (r.score_b as number | null) ?? null,
      rationale: (r.rationale as string | null) ?? null,
    }));
  }

  saveTiebreak(matchId: string, winnerSide: "a" | "b", rationale: string): void {
    this.db.prepare(`INSERT INTO tiebreaks (match_id, winner_side, rationale) VALUES (?, ?, ?)`).run(matchId, winnerSide, rationale);
  }

  getTiebreak(matchId: string): { winnerSide: "a" | "b"; rationale: string } | null {
    const r = this.db.prepare(`SELECT * FROM tiebreaks WHERE match_id = ?`).get(matchId) as Row | undefined;
    return r ? { winnerSide: r.winner_side as "a" | "b", rationale: r.rationale as string } : null;
  }

  /** Discard partial judging for every unfinished match (used on resume). */
  clearIncompleteJudging(tournamentId: string): number {
    return this.tx(() => {
      const ids = (this.db.prepare(`SELECT id FROM matches WHERE tournament_id = ? AND done = 0`).all(tournamentId) as Row[]).map(
        (r) => r.id as string,
      );
      let n = 0;
      for (const id of ids) {
        n += this.db.prepare(`DELETE FROM scores WHERE match_id = ?`).run(id).changes;
        n += this.db.prepare(`DELETE FROM tiebreaks WHERE match_id = ?`).run(id).changes;
      }
      return n;
    });
  }

  // ---- costs -------------------------------------------------------------

  addCost(entry: { tournamentId: string; agentRole: string; round: string | null; matchId: string | null; costUsd: number }): void {
    this.db
      .prepare(`INSERT INTO costs (tournament_id, agent_role, round, match_id, cost_usd, at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(entry.tournamentId, entry.agentRole, entry.round, entry.matchId, entry.costUsd, new Date().toISOString());
  }

  totalCost(tournamentId: string): number {
    const r = this.db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS c FROM costs WHERE tournament_id = ?`).get(tournamentId) as Row;
    return r.c as number;
  }

  meanCost(tournamentId: string, agentRole: string): number | null {
    const r = this.db
      .prepare(`SELECT AVG(cost_usd) AS c, COUNT(*) AS n FROM costs WHERE tournament_id = ? AND agent_role = ?`)
      .get(tournamentId, agentRole) as Row;
    return (r.n as number) > 0 ? (r.c as number) : null;
  }
}

export class NotFoundError extends Error {}
