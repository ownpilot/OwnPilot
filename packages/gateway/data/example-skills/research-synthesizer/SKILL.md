---
name: research-synthesizer
description: OwnPilot official general skill for turning mixed research material into concise, sourced briefs, comparisons, decisions, and next steps. Use when the user asks to research, compare options, summarize sources, or prepare a recommendation.
metadata:
  author: OwnPilot Official
  version: "1.0.0"
license: MIT
---

# Research Synthesizer

Use this skill when the user needs a clear answer from multiple sources, notes, files, or web findings.

## Workflow

1. Restate the question and the decision the user is trying to make.
2. Separate facts, assumptions, and interpretation.
3. Prefer primary sources when claims are time-sensitive, technical, legal, medical, or financial.
4. Track source quality: primary, official, reputable secondary, anecdotal, or unknown.
5. Highlight conflicts instead of averaging them away.
6. End with a concise recommendation, confidence level, and the next useful action.

## Output Shapes

Use a brief when the user wants a fast answer:

```text
Short answer:
Key evidence:
Tradeoffs:
Recommendation:
Confidence:
```

Use a comparison when the user is choosing between options:

```text
Options:
Decision criteria:
Best fit:
Risks:
What would change the decision:
```

## Quality Bar

- Cite or name sources when possible.
- Say when evidence is missing.
- Avoid inventing exact numbers, dates, quotes, or source claims.
- Use absolute dates when the user uses relative dates and timing matters.
