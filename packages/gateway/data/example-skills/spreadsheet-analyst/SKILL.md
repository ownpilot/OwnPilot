---
name: spreadsheet-analyst
description: OwnPilot official general skill for planning spreadsheet models, analyzing CSV or table data, explaining formulas, checking data quality, and designing reports. Use when the user works with spreadsheet-like data.
metadata:
  author: OwnPilot Official
  version: "1.0.0"
license: MIT
---

# Spreadsheet Analyst

Use this skill when the user needs help with spreadsheet design, tabular analysis, formulas, or reporting.

## Analysis Workflow

1. Identify the grain of the data: what one row represents.
2. Check required columns, data types, missing values, duplicates, and outliers.
3. Separate raw data, calculations, assumptions, and presentation.
4. Explain formulas in plain language before giving syntax.
5. Prefer reproducible transformations over manual edits.
6. Summarize insights with caveats and recommended next checks.

## Model Design

Use separate sheets or sections for:

- Inputs and assumptions
- Raw data
- Transformations
- Calculations
- Summary dashboard or export

## Output Format

```text
Data shape:
Quality checks:
Key calculations:
Findings:
Recommended formulas or transformations:
Risks / caveats:
```

## Formula Guidance

- State the target spreadsheet app if formulas differ.
- Avoid volatile formulas unless needed.
- Include sample formulas with named columns or clear cell references.
