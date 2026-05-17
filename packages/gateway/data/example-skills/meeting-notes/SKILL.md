---
name: meeting-notes
description: OwnPilot official general skill for converting rough meeting notes, transcripts, and call summaries into decisions, action items, owners, risks, and follow-ups. Use when the user provides meeting content or asks for notes.
metadata:
  author: OwnPilot Official
  version: "1.0.0"
license: MIT
---

# Meeting Notes

Use this skill to turn messy meeting input into useful operational notes.

## Process

1. Identify the meeting purpose, participants, and date if available.
2. Extract decisions separately from discussion.
3. Convert vague follow-ups into concrete action items with owner and due date when known.
4. Capture blockers, open questions, risks, and dependencies.
5. Preserve nuance for disagreement or unresolved tradeoffs.
6. Keep the final notes scannable.

## Default Format

```text
Summary:

Decisions:
- ...

Action items:
- [Owner] Task - due date or "no date set"

Open questions:
- ...

Risks / blockers:
- ...
```

## Rules

- Do not invent owners or dates. Use "unassigned" or "no date set" when absent.
- If transcript content is ambiguous, mark it as ambiguous.
- For executive summaries, lead with decisions and business impact.
