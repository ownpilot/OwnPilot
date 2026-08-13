/**
 * Parity between the three places a widget name is listed.
 *
 * A chat widget's name travels across a package boundary, and three separate
 * lists have to agree on it:
 *
 *   1. `gateway/src/utils/chat-widgets.ts` — `WIDGET_TAG_NAMES`, the tags the
 *      gateway recognises in model output and normalises into widget JSON.
 *   2. `ui/src/components/ChatMessageWidget.tsx` — the render switch.
 *   3. `ui/src/components/widgets/widget-types.ts` — the `WidgetType` union.
 *
 * Nothing connected them. The gateway can start emitting a tag the UI has no
 * case for, and the user sees a raw JSON dump instead of a widget — silently,
 * with every gate green. `WidgetType` was written to be the single source of
 * truth but nothing imported it, so it had drifted into decoration.
 *
 * These tests read the three lists out of source and assert they line up. That
 * is a deliberate choice over deleting the unused union: the union is not dead
 * weight, it is an unenforced contract, and the cheap fix is to enforce it.
 *
 * The gateway file is read by path rather than imported — the UI package does
 * not depend on the gateway, and should not start doing so for a test. If that
 * file moves, this fails loudly, which is the correct outcome.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { WidgetType } from './widget-types';

const here = dirname(fileURLToPath(import.meta.url));

function read(relative: string): string {
  return readFileSync(resolve(here, relative), 'utf-8');
}

/** Names between `const WIDGET_TAG_NAMES = [` and its closing `] as const;`. */
function gatewayTagNames(): Set<string> {
  const src = read('../../../../gateway/src/utils/chat-widgets.ts');
  const start = src.indexOf('const WIDGET_TAG_NAMES = [');
  expect(start, 'WIDGET_TAG_NAMES not found — did chat-widgets.ts move?').toBeGreaterThan(-1);
  const block = src.slice(start, src.indexOf('] as const;', start));
  const names = new Set(block.match(/'([a-z_]+)'/g)?.map((s) => s.slice(1, -1)) ?? []);
  // The generic <widget name="..."> wrapper is not itself a widget kind.
  names.delete('widget');
  return names;
}

/** Members of the `WidgetType` union. */
function declaredWidgetTypes(): Set<string> {
  const src = read('./widget-types.ts');
  const start = src.indexOf('export type WidgetType =');
  expect(start, 'WidgetType union not found').toBeGreaterThan(-1);
  const block = src.slice(start, src.indexOf(';', start));
  return new Set(block.match(/'([a-z_]+)'/g)?.map((s) => s.slice(1, -1)) ?? []);
}

/** `case '...':` labels of the render switch (the last switch in the file). */
function dispatchedWidgetTypes(): Set<string> {
  const src = read('../ChatMessageWidget.tsx');
  // Take the final switch only — an earlier one maps tones, not widget names.
  const block = src.slice(src.lastIndexOf('switch ('));
  return new Set(block.match(/case '([a-z_]+)':/g)?.map((s) => s.slice(6, -2)) ?? []);
}

/**
 * Names the dispatcher intentionally leaves to the JSON fallback.
 *
 * `json` / `raw` are the fallback's own names. `map` is a widget kind the
 * gateway accepts but the UI has never implemented — it renders as raw JSON
 * today. Listing it here keeps that a recorded decision instead of an
 * accident; delete the entry when a MapWidget lands.
 */
// The literals are checked against WidgetType — that is what makes the union
// load-bearing; remove a name from it and this stops compiling. The variable is
// then widened to string so it can be queried with names extracted from source.
const RENDERED_AS_JSON: ReadonlySet<string> = new Set<WidgetType>(['json', 'raw', 'map']);

/**
 * Widget names the system prompt advertises to the model.
 *
 * `gateway/src/services/agent/prompt.ts` lists a curated subset on its
 * "Names: ..." lines. A name here that the gateway's parser does not recognise
 * means the model is being told to emit a tag that gets silently dropped.
 */
function promptAdvertisedNames(): Set<string> {
  const src = read('../../../../gateway/src/services/agent/prompt.ts');
  const lines = src.match(/^\s*Names: .+$/gm) ?? [];
  expect(
    lines.length,
    'no "Names:" line in the agent prompt — did the format change?'
  ).toBeGreaterThan(0);
  const names = new Set<string>();
  for (const line of lines) {
    for (const n of line.replace(/^\s*Names:\s*/, '').split(',')) {
      const trimmed = n.trim();
      if (trimmed) names.add(trimmed);
    }
  }
  return names;
}

describe('widget name parity', () => {
  it('every tag the gateway emits is handled by the UI or a known fallback', () => {
    const unhandled = [...gatewayTagNames()].filter(
      (n) => !dispatchedWidgetTypes().has(n) && !RENDERED_AS_JSON.has(n)
    );
    expect(
      unhandled,
      'these widget tags reach the UI and render as a raw JSON dump; add a case to ChatMessageWidget or list them in RENDERED_AS_JSON'
    ).toEqual([]);
  });

  it('the UI never dispatches a name the gateway cannot produce', () => {
    // A case here with no producer is dead render code.
    const orphaned = [...dispatchedWidgetTypes()].filter((n) => !gatewayTagNames().has(n));
    expect(orphaned).toEqual([]);
  });

  it('the WidgetType union matches what the gateway recognises', () => {
    expect([...declaredWidgetTypes()].sort()).toEqual([...gatewayTagNames()].sort());
  });

  it('lists are non-trivial, so a failed extraction cannot pass as agreement', () => {
    // Every assertion above compares two sets; two empty sets are equal. If a
    // regex silently stops matching, these guards fail instead.
    expect(gatewayTagNames().size).toBeGreaterThan(30);
    expect(declaredWidgetTypes().size).toBeGreaterThan(30);
    expect(dispatchedWidgetTypes().size).toBeGreaterThan(30);
  });

  it('every widget the prompt advertises survives the pipeline', () => {
    // Advertising a subset is fine; advertising a name nothing parses is not.
    const dropped = [...promptAdvertisedNames()].filter((n) => !gatewayTagNames().has(n));
    expect(
      dropped,
      'the system prompt tells the model to emit these, but the gateway parser does not recognise them'
    ).toEqual([]);
  });

  it('every widget the prompt advertises actually renders', () => {
    const notRendered = [...promptAdvertisedNames()].filter((n) => !dispatchedWidgetTypes().has(n));
    expect(notRendered).toEqual([]);
  });

  it('fallback exemptions stay justified', () => {
    // If a MapWidget is added, the exemption must go with it.
    for (const name of RENDERED_AS_JSON) {
      expect(dispatchedWidgetTypes().has(name), `${name} is dispatched — drop the exemption`).toBe(
        false
      );
    }
  });
});
