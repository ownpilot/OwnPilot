import { describe, it, expect } from 'vitest';
import {
  topologicalSort,
  detectCycles,
  assignWaves,
  validateGraph,
  type DependencyNode,
  type WaveAssignment,
} from '../src/dependency-graph.ts';

describe('dependency-graph', () => {
  // ─── topologicalSort ─────────────────────────────────────────────

  describe('topologicalSort', () => {
    it('empty graph returns empty result', () => {
      expect(topologicalSort([])).toEqual([]);
    });

    it('single node with no deps returns [node]', () => {
      const nodes: DependencyNode[] = [{ id: 'A', dependsOn: [] }];
      expect(topologicalSort(nodes)).toEqual(['A']);
    });

    it('two independent nodes returns both (sorted for determinism)', () => {
      const nodes: DependencyNode[] = [
        { id: 'B', dependsOn: [] },
        { id: 'A', dependsOn: [] },
      ];
      const result = topologicalSort(nodes);
      expect(result).toHaveLength(2);
      expect(result).toContain('A');
      expect(result).toContain('B');
    });

    it('linear chain A->B->C returns valid order', () => {
      // A depends on nothing, B depends on A, C depends on B
      const nodes: DependencyNode[] = [
        { id: 'C', dependsOn: ['B'] },
        { id: 'A', dependsOn: [] },
        { id: 'B', dependsOn: ['A'] },
      ];
      const result = topologicalSort(nodes);
      expect(result).toHaveLength(3);
      expect(result.indexOf('A')).toBeLessThan(result.indexOf('B'));
      expect(result.indexOf('B')).toBeLessThan(result.indexOf('C'));
    });

    it('diamond: A->C, B->C returns A,B before C', () => {
      const nodes: DependencyNode[] = [
        { id: 'A', dependsOn: [] },
        { id: 'B', dependsOn: [] },
        { id: 'C', dependsOn: ['A', 'B'] },
      ];
      const result = topologicalSort(nodes);
      expect(result).toHaveLength(3);
      expect(result.indexOf('A')).toBeLessThan(result.indexOf('C'));
      expect(result.indexOf('B')).toBeLessThan(result.indexOf('C'));
    });

    it('complex DAG returns valid topological order', () => {
      // A -> C, B -> D, C -> E, D -> E
      const nodes: DependencyNode[] = [
        { id: 'A', dependsOn: [] },
        { id: 'B', dependsOn: [] },
        { id: 'C', dependsOn: ['A'] },
        { id: 'D', dependsOn: ['B'] },
        { id: 'E', dependsOn: ['C', 'D'] },
      ];
      const result = topologicalSort(nodes);
      expect(result).toHaveLength(5);
      expect(result.indexOf('A')).toBeLessThan(result.indexOf('C'));
      expect(result.indexOf('B')).toBeLessThan(result.indexOf('D'));
      expect(result.indexOf('C')).toBeLessThan(result.indexOf('E'));
      expect(result.indexOf('D')).toBeLessThan(result.indexOf('E'));
    });

    it('cycle A->B->C->A throws error containing "cycle"', () => {
      const nodes: DependencyNode[] = [
        { id: 'A', dependsOn: ['C'] },
        { id: 'B', dependsOn: ['A'] },
        { id: 'C', dependsOn: ['B'] },
      ];
      expect(() => topologicalSort(nodes)).toThrowError(/cycle/i);
    });

    it('self-cycle A->A throws error containing "cycle"', () => {
      const nodes: DependencyNode[] = [{ id: 'A', dependsOn: ['A'] }];
      expect(() => topologicalSort(nodes)).toThrowError(/cycle/i);
    });

    it('larger DAG with fan-out and fan-in', () => {
      // R -> A, R -> B, R -> C, A -> D, B -> D, C -> E, D -> F, E -> F
      const nodes: DependencyNode[] = [
        { id: 'R', dependsOn: [] },
        { id: 'A', dependsOn: ['R'] },
        { id: 'B', dependsOn: ['R'] },
        { id: 'C', dependsOn: ['R'] },
        { id: 'D', dependsOn: ['A', 'B'] },
        { id: 'E', dependsOn: ['C'] },
        { id: 'F', dependsOn: ['D', 'E'] },
      ];
      const result = topologicalSort(nodes);
      expect(result).toHaveLength(7);
      expect(result.indexOf('R')).toBeLessThan(result.indexOf('A'));
      expect(result.indexOf('R')).toBeLessThan(result.indexOf('B'));
      expect(result.indexOf('R')).toBeLessThan(result.indexOf('C'));
      expect(result.indexOf('A')).toBeLessThan(result.indexOf('D'));
      expect(result.indexOf('B')).toBeLessThan(result.indexOf('D'));
      expect(result.indexOf('C')).toBeLessThan(result.indexOf('E'));
      expect(result.indexOf('D')).toBeLessThan(result.indexOf('F'));
      expect(result.indexOf('E')).toBeLessThan(result.indexOf('F'));
    });

    it('partial cycle in larger graph throws', () => {
      // A -> B, B -> C, C -> B (cycle), D -> A (D is fine)
      const nodes: DependencyNode[] = [
        { id: 'D', dependsOn: [] },
        { id: 'A', dependsOn: ['D'] },
        { id: 'B', dependsOn: ['A', 'C'] },
        { id: 'C', dependsOn: ['B'] },
      ];
      expect(() => topologicalSort(nodes)).toThrowError(/cycle/i);
    });
  });

  // ─── detectCycles ────────────────────────────────────────────────

  describe('detectCycles', () => {
    it('no cycles returns empty array', () => {
      const nodes: DependencyNode[] = [
        { id: 'A', dependsOn: [] },
        { id: 'B', dependsOn: ['A'] },
      ];
      expect(detectCycles(nodes)).toEqual([]);
    });

    it('simple cycle returns cycle path', () => {
      const nodes: DependencyNode[] = [
        { id: 'A', dependsOn: ['B'] },
        { id: 'B', dependsOn: ['A'] },
      ];
      const cycles = detectCycles(nodes);
      expect(cycles.length).toBeGreaterThanOrEqual(1);
      // At least one cycle should contain both A and B
      const hasABCycle = cycles.some(
        (cycle) => cycle.includes('A') && cycle.includes('B'),
      );
      expect(hasABCycle).toBe(true);
    });

    it('three-node cycle returns cycle path', () => {
      const nodes: DependencyNode[] = [
        { id: 'A', dependsOn: ['C'] },
        { id: 'B', dependsOn: ['A'] },
        { id: 'C', dependsOn: ['B'] },
      ];
      const cycles = detectCycles(nodes);
      expect(cycles.length).toBeGreaterThanOrEqual(1);
      const hasFullCycle = cycles.some(
        (cycle) =>
          cycle.includes('A') && cycle.includes('B') && cycle.includes('C'),
      );
      expect(hasFullCycle).toBe(true);
    });

    it('multiple independent cycles returns all', () => {
      // Cycle 1: A -> B -> A
      // Cycle 2: C -> D -> C
      const nodes: DependencyNode[] = [
        { id: 'A', dependsOn: ['B'] },
        { id: 'B', dependsOn: ['A'] },
        { id: 'C', dependsOn: ['D'] },
        { id: 'D', dependsOn: ['C'] },
      ];
      const cycles = detectCycles(nodes);
      expect(cycles.length).toBeGreaterThanOrEqual(2);
    });

    it('self-cycle detected', () => {
      const nodes: DependencyNode[] = [{ id: 'A', dependsOn: ['A'] }];
      const cycles = detectCycles(nodes);
      expect(cycles.length).toBeGreaterThanOrEqual(1);
      const hasSelfCycle = cycles.some((cycle) => cycle.includes('A'));
      expect(hasSelfCycle).toBe(true);
    });

    it('DAG with no cycles returns empty', () => {
      const nodes: DependencyNode[] = [
        { id: 'A', dependsOn: [] },
        { id: 'B', dependsOn: ['A'] },
        { id: 'C', dependsOn: ['A'] },
        { id: 'D', dependsOn: ['B', 'C'] },
      ];
      expect(detectCycles(nodes)).toEqual([]);
    });

    it('empty graph returns empty array', () => {
      expect(detectCycles([])).toEqual([]);
    });
  });

  // ─── assignWaves ─────────────────────────────────────────────────

  describe('assignWaves', () => {
    it('empty graph returns empty waves', () => {
      expect(assignWaves([])).toEqual([]);
    });

    it('all independent nodes placed in single wave', () => {
      const nodes: DependencyNode[] = [
        { id: 'C', dependsOn: [] },
        { id: 'A', dependsOn: [] },
        { id: 'B', dependsOn: [] },
      ];
      const waves = assignWaves(nodes);
      expect(waves).toHaveLength(1);
      expect(waves[0].wave).toBe(1);
      expect(waves[0].nodeIds).toEqual(['A', 'B', 'C']); // sorted
    });

    it('linear chain creates one wave per node', () => {
      const nodes: DependencyNode[] = [
        { id: 'A', dependsOn: [] },
        { id: 'B', dependsOn: ['A'] },
        { id: 'C', dependsOn: ['B'] },
      ];
      const waves = assignWaves(nodes);
      expect(waves).toHaveLength(3);
      expect(waves[0]).toEqual({ wave: 1, nodeIds: ['A'] });
      expect(waves[1]).toEqual({ wave: 2, nodeIds: ['B'] });
      expect(waves[2]).toEqual({ wave: 3, nodeIds: ['C'] });
    });

    it('diamond creates 2 waves: [A,B] then [C]', () => {
      const nodes: DependencyNode[] = [
        { id: 'A', dependsOn: [] },
        { id: 'B', dependsOn: [] },
        { id: 'C', dependsOn: ['A', 'B'] },
      ];
      const waves = assignWaves(nodes);
      expect(waves).toHaveLength(2);
      expect(waves[0]).toEqual({ wave: 1, nodeIds: ['A', 'B'] });
      expect(waves[1]).toEqual({ wave: 2, nodeIds: ['C'] });
    });

    it('complex: A->C, B->D, C->E, D->E gives waves [A,B], [C,D], [E]', () => {
      const nodes: DependencyNode[] = [
        { id: 'A', dependsOn: [] },
        { id: 'B', dependsOn: [] },
        { id: 'C', dependsOn: ['A'] },
        { id: 'D', dependsOn: ['B'] },
        { id: 'E', dependsOn: ['C', 'D'] },
      ];
      const waves = assignWaves(nodes);
      expect(waves).toHaveLength(3);
      expect(waves[0]).toEqual({ wave: 1, nodeIds: ['A', 'B'] });
      expect(waves[1]).toEqual({ wave: 2, nodeIds: ['C', 'D'] });
      expect(waves[2]).toEqual({ wave: 3, nodeIds: ['E'] });
    });

    it('nodeIds sorted alphabetically within each wave', () => {
      const nodes: DependencyNode[] = [
        { id: 'Z', dependsOn: [] },
        { id: 'M', dependsOn: [] },
        { id: 'A', dependsOn: [] },
      ];
      const waves = assignWaves(nodes);
      expect(waves[0].nodeIds).toEqual(['A', 'M', 'Z']);
    });

    it('cycle throws error', () => {
      const nodes: DependencyNode[] = [
        { id: 'A', dependsOn: ['B'] },
        { id: 'B', dependsOn: ['A'] },
      ];
      expect(() => assignWaves(nodes)).toThrowError(/cycle/i);
    });

    it('single node with no deps is wave 1', () => {
      const nodes: DependencyNode[] = [{ id: 'X', dependsOn: [] }];
      const waves = assignWaves(nodes);
      expect(waves).toEqual([{ wave: 1, nodeIds: ['X'] }]);
    });

    it('deep chain produces sequential waves', () => {
      const nodes: DependencyNode[] = [
        { id: '01', dependsOn: [] },
        { id: '02', dependsOn: ['01'] },
        { id: '03', dependsOn: ['02'] },
        { id: '04', dependsOn: ['03'] },
        { id: '05', dependsOn: ['04'] },
      ];
      const waves = assignWaves(nodes);
      expect(waves).toHaveLength(5);
      for (let i = 0; i < 5; i++) {
        expect(waves[i].wave).toBe(i + 1);
        expect(waves[i].nodeIds).toEqual([`0${i + 1}`]);
      }
    });

    it('node depending on multiple waves placed in max+1', () => {
      // A(w1), B(w1), C depends on A (w2), D depends on A and C (w3)
      const nodes: DependencyNode[] = [
        { id: 'A', dependsOn: [] },
        { id: 'B', dependsOn: [] },
        { id: 'C', dependsOn: ['A'] },
        { id: 'D', dependsOn: ['A', 'C'] },
      ];
      const waves = assignWaves(nodes);
      expect(waves).toHaveLength(3);
      expect(waves[0]).toEqual({ wave: 1, nodeIds: ['A', 'B'] });
      expect(waves[1]).toEqual({ wave: 2, nodeIds: ['C'] });
      expect(waves[2]).toEqual({ wave: 3, nodeIds: ['D'] });
    });

    it('waves sorted by wave number', () => {
      const nodes: DependencyNode[] = [
        { id: 'B', dependsOn: ['A'] },
        { id: 'A', dependsOn: [] },
      ];
      const waves = assignWaves(nodes);
      expect(waves[0].wave).toBe(1);
      expect(waves[1].wave).toBe(2);
    });
  });

  // ─── validateGraph ───────────────────────────────────────────────

  describe('validateGraph', () => {
    it('valid graph returns {valid: true, errors: []}', () => {
      const nodes: DependencyNode[] = [
        { id: 'A', dependsOn: [] },
        { id: 'B', dependsOn: ['A'] },
      ];
      const result = validateGraph(nodes);
      expect(result).toEqual({ valid: true, errors: [] });
    });

    it('empty graph is valid', () => {
      expect(validateGraph([])).toEqual({ valid: true, errors: [] });
    });

    it('missing reference produces error message', () => {
      const nodes: DependencyNode[] = [
        { id: 'A', dependsOn: ['NONEXISTENT'] },
      ];
      const result = validateGraph(nodes);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.errors.some((e) => e.includes('NONEXISTENT'))).toBe(true);
    });

    it('self-reference produces error message', () => {
      const nodes: DependencyNode[] = [{ id: 'A', dependsOn: ['A'] }];
      const result = validateGraph(nodes);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(
        result.errors.some((e) => e.toLowerCase().includes('self')),
      ).toBe(true);
    });

    it('duplicate IDs produce error message', () => {
      const nodes: DependencyNode[] = [
        { id: 'A', dependsOn: [] },
        { id: 'A', dependsOn: [] },
      ];
      const result = validateGraph(nodes);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(
        result.errors.some((e) => e.toLowerCase().includes('duplicate')),
      ).toBe(true);
    });

    it('multiple errors all reported', () => {
      const nodes: DependencyNode[] = [
        { id: 'A', dependsOn: ['A'] }, // self-reference
        { id: 'A', dependsOn: ['MISSING'] }, // duplicate ID + missing ref
      ];
      const result = validateGraph(nodes);
      expect(result.valid).toBe(false);
      // Should have at least 2 distinct errors (dup + self-ref or missing)
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });

    it('valid complex graph with no issues', () => {
      const nodes: DependencyNode[] = [
        { id: '01', dependsOn: [] },
        { id: '02', dependsOn: [] },
        { id: '01-01', dependsOn: ['01'] },
        { id: '01-02', dependsOn: ['01'] },
        { id: '02-01', dependsOn: ['02', '01-01'] },
      ];
      const result = validateGraph(nodes);
      expect(result).toEqual({ valid: true, errors: [] });
    });

    it('missing reference includes which node references it', () => {
      const nodes: DependencyNode[] = [
        { id: 'B', dependsOn: ['GHOST'] },
      ];
      const result = validateGraph(nodes);
      expect(result.valid).toBe(false);
      // Error should mention both the referencing node and the missing target
      expect(
        result.errors.some((e) => e.includes('B') && e.includes('GHOST')),
      ).toBe(true);
    });
  });
});
