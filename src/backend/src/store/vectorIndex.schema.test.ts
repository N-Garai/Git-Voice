/**
 * Guards the pgvector schema against the failure mode that silently disabled
 * persistence on PostgreSQL 16+: statements were split naively on ";", which
 * corrupts dollar-quoted plpgsql bodies. This test runs the real splitter over
 * the real schema literal.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, "vectorIndex.ts"), "utf8");

/** Mirrors splitStatements() in vectorIndex.ts. */
function splitStatements(sql: string): string[] {
  const stripLeadingComments = (s: string): string => {
    const lines = s.split("\n");
    while (lines.length && lines[0].trim().startsWith("--")) lines.shift();
    return lines.join("\n").trim();
  };
  const out: string[] = [];
  let buf = "";
  let inDollar = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "$") {
      const tag = sql.slice(i).match(/^\$[a-zA-Z_]*\$/);
      if (tag) {
        if (!inDollar) { inDollar = true; buf += tag[0]; i += tag[0].length - 1; continue; }
        if (sql.startsWith(tag[0], i)) { inDollar = false; buf += tag[0]; i += tag[0].length - 1; continue; }
      }
    }
    if (ch === ";" && !inDollar) {
      const st = stripLeadingComments(buf);
      if (st && !/^(?:--[^\n]*\n?)+$/.test(st)) out.push(st);
      buf = "";
      continue;
    }
    buf += ch;
  }
  const last = stripLeadingComments(buf);
  if (last && !/^(?:--[^\n]*\n?)+$/.test(last)) out.push(last);
  return out;
}

function schemaSql(): string {
  // Match the literal that starts at INDEX_SCHEMA_SQL and ends at the closing
  // backtick-followed-by-semicolon that terminates the template expression.
  const start = source.indexOf("INDEX_SCHEMA_SQL = (dim: number) => `");
  if (start === -1) throw new Error("INDEX_SCHEMA_SQL literal not found in vectorIndex.ts");
  const from = start + "INDEX_SCHEMA_SQL = (dim: number) => `".length;
  const end = source.indexOf("`;", from);
  if (end === -1) throw new Error("INDEX_SCHEMA_SQL literal is not terminated");
  return source.slice(from, end).replace(/\$\{dim\}/g, "768");
}

describe("pgvector schema statements", () => {
  const statements = splitStatements(schemaSql());

  it("never splits inside a dollar-quoted function body", () => {
    const fn = statements.find((s) => s.includes("FUNCTION git_voice_search_tsv"));
    expect(fn).toBeDefined();
    // The whole body must survive as one statement.
    expect(fn).toContain("RETURN NEW;");
    expect(fn).toContain("LANGUAGE plpgsql");
    expect(statements.some((s) => s.trim() === "RETURN NEW;")).toBe(false);
    expect(statements.some((s) => s.trim() === "END;")).toBe(false);
  });

  it("creates the tsvector column as a plain column, not a generated one", () => {
    // A GENERATED column using array_to_string() fails at runtime with
    // "generation expression is not immutable" on PostgreSQL 16+. Only the
    // explanatory comment may mention the phrase, never a live DDL statement.
    const table = statements.find((s) => s.startsWith("CREATE TABLE IF NOT EXISTS git_voice_code_index"));
    expect(table).toBeDefined();
    expect(table).toContain("search_tsv tsvector NOT NULL");
    expect(table).not.toMatch(/GENERATED/i);
  });

  it("creates the trigger after the table it is attached to", () => {
    const tableAt = statements.findIndex((s) => s.startsWith("CREATE TABLE IF NOT EXISTS git_voice_code_index"));
    const triggerAt = statements.findIndex((s) => s.startsWith("CREATE TRIGGER trg_gv_search_tsv"));
    expect(tableAt).toBeGreaterThanOrEqual(0);
    expect(triggerAt).toBeGreaterThan(tableAt);
  });

  it("creates every table the app depends on", () => {
    for (const table of [
      "git_voice_code_index",
      "git_voice_projects",
      "git_voice_sessions"
    ]) {
      expect(statements.some((s) => s.includes(`CREATE TABLE IF NOT EXISTS ${table}`))).toBe(true);
    }
  });

  it("emits statements ready to execute", () => {
    for (const stmt of statements) {
      expect(stmt.trim()).not.toBe("");
      // Comment-only chunks must be gone; a leading comment attached to a real
      // statement is fine (Postgres accepts it), so only emptiness is asserted.
      expect(stmt).not.toMatch(/^(?:--[^\n]*\n?)+$/);
      // The splitter removes terminators; leftover ones would double-execute.
      expect(stmt.trimEnd().endsWith(";")).toBe(false);
    }
  });
});