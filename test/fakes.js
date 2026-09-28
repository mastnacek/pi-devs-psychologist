/**
 * Test fakes — a minimal stand-in for `ExtensionAPI` / `ExtensionContext`, plus
 * one hand-built session fixture.
 *
 * Deliberately structural rather than mock-library based: these tests are about
 * what the plugin does with the engine surface — which event produces which
 * observation — so the fakes record calls and nothing else.
 *
 * `sessionFixture` is the important piece. It is a session written by hand with
 * *known* properties (3 tool failures, one restatement, one successful
 * verification, one churn file), so every assertion in `signals.test.js` is a
 * comparison against a number a human counted, not against whatever the code
 * happened to produce.
 */

import { createDevsPsychologistState } from "../src/shared/state.js";

export function makePi() {
  const tools = new Map();
  const commands = new Map();
  const handlers = new Map();
  const entries = [];
  const unsubscribed = [];
  return {
    tools,
    commands,
    handlers,
    entries,
    /** Events whose unsubscribe function was invoked — proves the drain happened. */
    unsubscribed,
    on(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {
        unsubscribed.push(event);
      };
    },
    registerTool(def) {
      tools.set(def.name, def);
    },
    registerCommand(name, def) {
      commands.set(name, def);
    },
    appendEntry(customType, data) {
      entries.push({ type: "custom", customType, data });
    },
    /** Fire every handler registered for an event. */
    async emit(event, payload, ctx = {}) {
      for (const handler of handlers.get(event) ?? []) {
        await handler(payload, ctx);
      }
    },
  };
}

export function makeCtx(over = {}) {
  const status = [];
  const notes = [];
  return {
    mode: "tui",
    hasUI: true,
    cwd: process.cwd(),
    ui: {
      setStatus: (id, text) => status.push({ id, text }),
      notify: (message, level) => notes.push({ message, level }),
      select: async () => undefined,
    },
    sessionManager: { getEntries: () => [] },
    isIdle: () => true,
    statusCalls: status,
    notes,
    ...over,
  };
}

export function makeState(over = {}) {
  const state = createDevsPsychologistState(makePi());
  return Object.assign(state, over);
}

const T0 = 1_700_000_000_000;
const MINUTE = 60_000;

/** Prompt carrying a file, a command and a name — fully anchored. */
export const SCOPED_PROMPT = "Fix npm test in src/shared/signals.ts";

/** The same prompt again, word for word: a restatement. */
export const RESTATED_PROMPT = "Fix npm test in src/shared/signals.ts";

/**
 * Long, anchor-free, correction-marked prompt. Deliberately contains no file,
 * path, backtick, command word or `foo()` form, and borrows no vocabulary from
 * `SCOPED_PROMPT`, so it moves exactly two counters (unscoped, corrections).
 */
export const UNSCOPED_PROMPT =
  "Znovu se mi zda ze tomu celemu chybi nejaky jasny smer a porad nevim kterym " +
  "krokem vlastne zaciname protoze zadani je prilis siroke a neda se nikde " +
  "rozdelit na mensi casti ktere bychom mohli opravdu dotahnout do konce";

/**
 * A session with counted properties:
 *   3 prompts (1 restated, 1 unscoped, 1 with a correction marker)
 *   8 tool calls, 3 of them failures, 1 file churned, 1 verified run
 *   4 completed turns
 * Edit this and update the counts in signals.test.js — that is the point of it.
 */
export function sessionFixture() {
  const log = [];
  const push = (item) => log.push(item);

  push({ kind: "prompt", at: T0, text: SCOPED_PROMPT });

  // Four mutations: three on one file (churn), one on another.
  push({ kind: "tool", at: T0 + 1_000, toolName: "edit", path: "src/shared/signals.ts", ok: true });
  push({ kind: "tool", at: T0 + 2_000, toolName: "edit", path: "src/shared/signals.ts", ok: true });
  push({ kind: "tool", at: T0 + 3_000, toolName: "edit", path: "src/shared/signals.ts", ok: true });
  push({ kind: "tool", at: T0 + 4_000, toolName: "write", path: "src/shared/lexicon.ts", ok: true });

  // Three failures: bash twice, edit once.
  push({ kind: "tool", at: T0 + 5_000, toolName: "bash", command: "npm test", ok: false });
  push({ kind: "tool", at: T0 + 6_000, toolName: "edit", path: "src/shared/signals.ts", ok: false });
  push({ kind: "tool", at: T0 + 7_000, toolName: "bash", command: "npm test", ok: false });

  push({ kind: "turn", at: T0 + 8_000 });

  // The one run that actually proved something.
  push({ kind: "tool", at: T0 + 9_000, toolName: "bash", command: "npm test", ok: true });
  push({ kind: "turn", at: T0 + 10_000 });

  push({ kind: "prompt", at: T0 + 12_000, text: RESTATED_PROMPT });
  push({ kind: "turn", at: T0 + 13_000 });

  // ~12 minutes later: the interruption gap, and the long unscoped prompt.
  push({ kind: "prompt", at: T0 + 12 * MINUTE, text: UNSCOPED_PROMPT });
  push({ kind: "turn", at: T0 + 12 * MINUTE + 1_000 });

  return log;
}

/** Counted expectations for `sessionFixture`, in one place. */
export const FIXTURE_EXPECTED = {
  promptCount: 3,
  restatedPrompts: 1,
  unscopedPrompts: 1,
  promptsWithCorrectionMarkers: 1,
  turns: 4,
  toolCalls: 8,
  toolFailures: 3,
  toolFailureRate: 3 / 8,
  failingTools: ["bash"],
  filesTouched: 2,
  churnedFiles: ["src/shared/signals.ts"],
  verificationRuns: 1,
  // Turns at +10_000, +13_000 and +12*MINUTE+1_000 come after the verified run.
  turnsSinceVerifiedProgress: 3,
  idleGaps: 1,
  unverifiedWindow: false,
};