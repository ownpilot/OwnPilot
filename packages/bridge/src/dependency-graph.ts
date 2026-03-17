/**
 * Pure dependency graph module for topological sorting and wave assignment.
 *
 * - No imports from bridge code, no side effects.
 * - Kahn's algorithm for topological sort.
 * - DFS-based cycle detection.
 * - Depth-based wave grouping for parallel execution planning.
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface DependencyNode {
  /** Unique identifier, e.g. "01", "02", "01-01" */
  id: string;
  /** IDs this node depends on (must complete before this node) */
  dependsOn: string[];
}

export interface WaveAssignment {
  /** 1-based wave number */
  wave: number;
  /** Node IDs in this wave, sorted alphabetically for determinism */
  nodeIds: string[];
}

// ─── topologicalSort ────────────────────────────────────────────────

/**
 * Topological sort using Kahn's algorithm (BFS-based).
 *
 * @param nodes - Array of dependency nodes
 * @returns IDs in topological order (dependencies before dependents)
 * @throws Error with message containing 'cycle' if a cycle is detected
 */
export function topologicalSort(nodes: DependencyNode[]): string[] {
  if (nodes.length === 0) return [];

  const nodeIds = new Set(nodes.map((n) => n.id));

  // Build adjacency list and in-degree map
  // Edge: dependency -> dependent (from depends-on to the node that depends)
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const id of nodeIds) {
    adjacency.set(id, []);
    inDegree.set(id, 0);
  }

  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (nodeIds.has(dep)) {
        adjacency.get(dep)!.push(node.id);
        inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
      }
    }
  }

  // Seed queue with nodes that have zero in-degree, sorted for determinism
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  queue.sort();

  const result: string[] = [];

  while (queue.length > 0) {
    // Always take the smallest lexicographic node for determinism
    queue.sort();
    const current = queue.shift()!;
    result.push(current);

    for (const neighbor of adjacency.get(current) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (result.length !== nodeIds.size) {
    throw new Error(
      'Dependency graph contains a cycle — topological sort is impossible',
    );
  }

  return result;
}

// ─── detectCycles ───────────────────────────────────────────────────

/**
 * DFS-based cycle detection.
 *
 * @param nodes - Array of dependency nodes
 * @returns Array of cycle paths (each path = array of IDs forming the cycle).
 *          Empty array if no cycles.
 */
export function detectCycles(nodes: DependencyNode[]): string[][] {
  if (nodes.length === 0) return [];

  const nodeIds = new Set(nodes.map((n) => n.id));

  // Build adjacency: node -> its dependencies (edges point to what it depends on)
  const dependsOnMap = new Map<string, string[]>();
  for (const node of nodes) {
    dependsOnMap.set(
      node.id,
      node.dependsOn.filter((d) => nodeIds.has(d)),
    );
  }

  const WHITE = 0; // not visited
  const GRAY = 1; // in current DFS path
  const BLACK = 2; // fully processed

  const color = new Map<string, number>();
  for (const id of nodeIds) {
    color.set(id, WHITE);
  }

  const cycles: string[][] = [];
  const path: string[] = [];

  function dfs(nodeId: string): void {
    color.set(nodeId, GRAY);
    path.push(nodeId);

    for (const dep of dependsOnMap.get(nodeId) ?? []) {
      if (color.get(dep) === GRAY) {
        // Found a cycle: extract the cycle from path
        const cycleStart = path.indexOf(dep);
        const cycle = path.slice(cycleStart);
        cycles.push([...cycle]);
      } else if (color.get(dep) === WHITE) {
        dfs(dep);
      }
    }

    path.pop();
    color.set(nodeId, BLACK);
  }

  // Sort for deterministic traversal order
  const sortedIds = [...nodeIds].sort();
  for (const id of sortedIds) {
    if (color.get(id) === WHITE) {
      dfs(id);
    }
  }

  return cycles;
}

// ─── assignWaves ────────────────────────────────────────────────────

/**
 * Depth-based wave grouping.
 *
 * - Wave 1 = nodes with no dependencies
 * - Wave N = nodes whose dependencies are all in waves < N
 * - Each wave's nodeIds are sorted alphabetically
 *
 * @param nodes - Array of dependency nodes
 * @returns Array of WaveAssignments sorted by wave number
 * @throws Error with message containing 'cycle' if a cycle is detected
 */
export function assignWaves(nodes: DependencyNode[]): WaveAssignment[] {
  if (nodes.length === 0) return [];

  // First check for cycles by attempting topological sort
  // (this will throw if cycles exist)
  topologicalSort(nodes);

  const nodeIds = new Set(nodes.map((n) => n.id));

  // Build depends-on map (only valid references)
  const dependsOnMap = new Map<string, string[]>();
  for (const node of nodes) {
    dependsOnMap.set(
      node.id,
      node.dependsOn.filter((d) => nodeIds.has(d)),
    );
  }

  // Compute wave for each node using memoized recursion
  const waveOf = new Map<string, number>();

  function computeWave(nodeId: string): number {
    if (waveOf.has(nodeId)) return waveOf.get(nodeId)!;

    const deps = dependsOnMap.get(nodeId) ?? [];
    if (deps.length === 0) {
      waveOf.set(nodeId, 1);
      return 1;
    }

    let maxDepWave = 0;
    for (const dep of deps) {
      maxDepWave = Math.max(maxDepWave, computeWave(dep));
    }

    const wave = maxDepWave + 1;
    waveOf.set(nodeId, wave);
    return wave;
  }

  for (const id of nodeIds) {
    computeWave(id);
  }

  // Group by wave
  const waveGroups = new Map<number, string[]>();
  for (const [id, wave] of waveOf) {
    if (!waveGroups.has(wave)) {
      waveGroups.set(wave, []);
    }
    waveGroups.get(wave)!.push(id);
  }

  // Build sorted result
  const waveNumbers = [...waveGroups.keys()].sort((a, b) => a - b);
  return waveNumbers.map((wave) => ({
    wave,
    nodeIds: waveGroups.get(wave)!.sort(),
  }));
}

// ─── validateGraph ──────────────────────────────────────────────────

/**
 * Validate graph structure for common issues.
 *
 * Checks for:
 * - Missing references (dependsOn references an ID not in the graph)
 * - Self-references (node depends on itself)
 * - Duplicate IDs
 *
 * @param nodes - Array of dependency nodes
 * @returns Object with valid boolean and array of error messages
 */
export function validateGraph(nodes: DependencyNode[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check for duplicate IDs
  const seenIds = new Set<string>();
  for (const node of nodes) {
    if (seenIds.has(node.id)) {
      errors.push(`Duplicate node ID: "${node.id}"`);
    }
    seenIds.add(node.id);
  }

  // Collect all valid IDs (using full set, including duplicates' first occurrence)
  const allIds = new Set(nodes.map((n) => n.id));

  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      // Self-reference check
      if (dep === node.id) {
        errors.push(
          `Self-reference: node "${node.id}" depends on itself`,
        );
      }
      // Missing reference check
      else if (!allIds.has(dep)) {
        errors.push(
          `Missing reference: node "${node.id}" depends on "${dep}" which does not exist`,
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
