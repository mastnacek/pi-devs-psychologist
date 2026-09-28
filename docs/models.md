# Models — one plugin, several OpenRouter models

**This project will run multiple OpenRouter models side by side.** The whole point of
the plugin is that the observer is *not* the worker's model (PRD §3), and from
ADR 0001 the reviewer is a third role with its own model too. A single provider
account cannot serve all three well, which is exactly what
`pi-openrouter-accounts` is for.

---

## 1. How the plugin addresses a model

`config.model` is a single string, `provider/modelId` — the same handle the `/model`
picker shows:

```json
{ "model": "openrouter-soukr/deepseek/deepseek-v4.1-flash" }
```

Nothing about the plugin assumes a provider. It resolves whatever `provider/modelId`
is configured through `ctx.modelRegistry`, which is why it can point at a different
**account** as easily as at a different model.

## 2. The accounts available in this workshop

`pi-openrouter-accounts` registers each OpenRouter account as its **own provider id**,
`openrouter-<id>`, since Pi stores exactly one credential per provider id. The
current `~/.pi/agent/openrouter-accounts.json`:

| Account id | Provider id | Notes |
|---|---|---|
| `default` | `openrouter-default` | the main account |
| `soukr` | `openrouter-soukr` | **`onlyFree: true`** — free-tier models only |

So a model reference looks like:

```
openrouter-default/anthropic/claude-….        ← main account
openrouter-soukr/<any :free model>            ← free-tier account
```

Inspect or extend them with `/openrouter-accounts list` / `add` / `edit <id>`.
Credentials live in `auth.json` and are owned by that plugin — **never put a key,
base URL or token source in this plugin's config.**

## 3. Recommended role → account mapping

The mapping follows the cadence and the volume, not the prestige of the role.

| Role | Cadence / volume | Account | Why |
|---|---|---|---|
| **worker** | every turn, high volume | `openrouter-default` | the model you can afford in bulk |
| **psychologist** | every `cadenceTurns` (default 8), ~7 evidence lines | `openrouter-soukr` (free) | a low-cadence observer is precisely the workload that fits a free tier — the appraisal can cost nothing extra while the work account's quota is untouched |
| **reviewer** (T12, unbuilt) | delivery boundaries, thousands of tokens of code | `openrouter-default` | review is where capability actually pays, so this is the one role worth spending on |

The psychologist on a free account and the work untouched is the cheapest possible
arrangement that still delivers a second opinion. That is the intended default.

**Today** the model is set in the config file — the `/psych` command is not built yet
(T2–T6):

```bash
# ~/.pi/agent/pi-devs-psychologist.json   (or <cwd>/.pi/pi-devs-psychologist.json)
{ "model": "openrouter-soukr/<a :free model>" }
```

**After T6** the same thing, from the session:

```bash
/psych model openrouter-soukr/<a :free model>
```

Until T4 lands, setting a model changes nothing except the chip: nothing calls it yet,
so the configured model is never invoked and still costs nothing.

## 4. Rules that do not bend

1. **The psychologist must not be the worker's model.** An observer sharing the
   worker's blind spots is not an observer. A different account is not automatically
   a different model — check the model id, not just the provider.
2. **`onlyFree` accounts reject paid models.** Configuring a paid model on
   `openrouter-soukr` will fail at call time, not at config time. `config.model` is
   validated as a *string* only, deliberately: the plugin must not pretend to know
   every provider's catalog.
3. **Evidence lines leave the machine too.** The psychologist sends counts, file
   paths, tool names, the session name and model ids to whatever account is
   configured — not message bodies (PRD §4.1), but genuinely session-derived text.
   Choosing an account is therefore a data-policy decision, not just a billing one.
   Confirm the account's data policy with `/openrouter-accounts edit <id>` if that
   matters to you; do not discover it by accident.
4. **Budget isolation is the point.** `maxAppraisalsPerSession` bounds the plugin's
   own spend, and a separate account bounds whose quota it comes out of. Both, or
   neither is really bounded.
5. **Never hardcode an account id in the plugin.** Account ids are the operator's
   configuration; the plugin only ever reads `config.model`.

## 5. Choosing a model from the registry

`/psych model` does not accept free text as its only path — it completes from **the models and
providers the engine has registered**, which is both more discoverable and more correct than
typing a reference by hand:

| Level | Typed | Offered |
|---|---|---|
| 1 | `/psych model ` | the registered providers, as `model <provider>/` |
| 2 | `/psych model openrouter-soukr/` | that provider's models, as `model <provider>/<id>` |

**Multi-account support needs no special handling**: `pi-openrouter-accounts` registers each
OpenRouter account as its own provider id, so listing the registry's providers *is* listing the
accounts.

Three rules the picker obeys:

- **Matching is substring, not prefix.** The account is `soukr` but its provider id is
  `openrouter-soukr`, and the interesting part of a model id is often in the middle — typing
  `claude` should find it without knowing the account prefix.
- **The list is capped at 50** with a row saying how many were hidden; a 400-row picker is the
  nagging this plugin exists to avoid. Selecting the overflow row changes nothing (it re-inserts
  what is already typed), so a truncation is never silent.
- **The model in effect is marked** with `✓` in the picker's label and `· ● current` in its
  description — on the model's own row *and* on its provider's row, so the current value is
  visible one level up. The marker never enters the inserted `value`.

A hand-typed reference still works: the picker is a convenience, not a gate. The catalog is
cached from the registry at session start and refreshed whenever `/psych` runs, so an account
added mid-session is picked up by the next Tab press. With no catalog at all the picker defers
to the engine's own completion rather than failing.

## 6. Verifying a setup

1. `/model` — confirm the provider id you intend to use appears with the right badge.
2. Write `model` into `~/.pi/agent/pi-devs-psychologist.json` (after T6:
   `/psych model <provider/modelId>`). With no model configured the chip reads
   `psych: signals` — observation is live and the spend is zero. Once a model is set
   it becomes `psych <n>t · 0/12` — `<n>` is turns since the last appraisal and
   `0/12` is the appraisal budget used, so the chip explains its own silence.
3. `/openrouter-accounts status` — configured vs actually registered providers, which
   catches a config that is written but not loaded.

Until the appraiser lands (T2–T4) the chip stays at `psych: signals` regardless:
observation works, and nothing is spent.
