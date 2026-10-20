# ADR 0007 — Safety is application code, not prompt wording

**Decision.** The model drafts; the application decides. Retrieval is limited to the approved snapshot; deterministic rules handle sensitive cases without the model; model output is schema-validated,
its evidence refs are verified against server-retrieved records, and figures/commitments the approved information does not contain are blocked. Owner permissions and platform policy gate whether the AI is called at all.
Customer text is untrusted data confined to JSON string fields.

**Consequences.** Some legitimate answers become "needs information" (safe failure). Heuristic guards are explicitly documented as defence in depth. Costs are reduced because many enquiries never reach the model.
**Not done.** No model self-reported confidence; no second "judge" model call (cost, and it would itself be an untrusted component).
