---
type: Note
title: "Model plan for this project: it will run multiple OpenRouter models for different roles, enabled by pi-openrouter-accounts which registers each account as its own provider id. Current accounts: openrouter-default (main) and openrouter-soukr (onlyFree). Mapping: worker on default, psychologist on soukr free tier (low cadence ~7 evidence lines fits a free tier, so the second opinion costs nothing extra and the work quota stays untouched), reviewer (T12) on default where capability pays. Rules recorded in docs/models.md: psychologist must not be the worker's model and a different account is not a different model; onlyFree rejects paid models at call time; evidence lines leave the machine so account choice is a data-policy decision too; budget isolation needs both maxAppraisalsPerSession and a separate account; account ids are never hardcoded in the plugin"
timestamp: 2026-09-28 18:24:08
status: note
source: pi-spai
tags: [models, openrouter, config]
facets:
  project: pi-devs-psychologist
  project_path: D:/01_programovani/pi/plugins/pi-devs-psychologist
spai_symbol: '-'
---

# SPAI-008: Model plan for this project: it will run multiple OpenRouter models for different roles, enabled by pi-openrouter-accounts which registers each account as its own provider id. Current accounts: openrouter-default (main) and openrouter-soukr (onlyFree). Mapping: worker on default, psychologist on soukr free tier (low cadence ~7 evidence lines fits a free tier, so the second opinion costs nothing extra and the work quota stays untouched), reviewer (T12) on default where capability pays. Rules recorded in docs/models.md: psychologist must not be the worker's model and a different account is not a different model; onlyFree rejects paid models at call time; evidence lines leave the machine so account choice is a data-policy decision too; budget isolation needs both maxAppraisalsPerSession and a separate account; account ids are never hardcoded in the plugin

- Model plan for this project: it will run multiple OpenRouter models for different roles, enabled by pi-openrouter-accounts which registers each account as its own provider id. Current accounts: openrouter-default (main) and openrouter-soukr (onlyFree). Mapping: worker on default, psychologist on soukr free tier (low cadence ~7 evidence lines fits a free tier, so the second opinion costs nothing extra and the work quota stays untouched), reviewer (T12) on default where capability pays. Rules recorded in docs/models.md: psychologist must not be the worker's model and a different account is not a different model; onlyFree rejects paid models at call time; evidence lines leave the machine so account choice is a data-policy decision too; budget isolation needs both maxAppraisalsPerSession and a separate account; account ids are never hardcoded in the plugin @pi-devs-psychologist :models:openrouter:config:
