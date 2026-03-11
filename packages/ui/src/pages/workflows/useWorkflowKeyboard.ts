/**
 * useWorkflowKeyboard — keyboard shortcut handler for the workflow editor.
 */

import { useEffect } from 'react';
import type { Edge, Node } from '@xyflow/react';

export interface WorkflowKeyboardParams {
  nodes: Node[];
  edges: Edge[];
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  showCopilot: boolean;
  setShowCopilot: (v: boolean) => void;
  showVariables: boolean;
  setShowVariables: (v: boolean) => void;
  showVersions: boolean;
  setShowVersions: (v: boolean) => void;
  showNodeSearch: boolean;
  setShowNodeSearch: (v: boolean) => void;
  setHasUnsavedChanges: (v: boolean) => void;
  nodeIdCounter: React.MutableRefObject<number>;
  clipboardRef: React.MutableRefObject<{ nodes: Node[]; edges: Edge[] } | null>;
  handleSave: () => Promise<void>;
  deleteNode: (nodeId: string) => void;
  undo: () => void;
  redo: () => void;
  pushHistory: () => void;
}

export function useWorkflowKeyboard(params: WorkflowKeyboardParams) {
  const {
    nodes,
    edges,
    setNodes,
    setEdges,
    selectedNodeId,
    setSelectedNodeId,
    hasUnsavedChanges,
    isSaving,
    showCopilot,
    setShowCopilot,
    showVariables,
    setShowVariables,
    showVersions,
    setShowVersions,
    showNodeSearch,
    setShowNodeSearch,
    setHasUnsavedChanges,
    nodeIdCounter,
    clipboardRef,
    handleSave,
    deleteNode,
    undo,
    redo,
    pushHistory,
  } = params;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip if user is typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement).isContentEditable) return;

      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl+S -- Save
      if (ctrl && e.key === 's') {
        e.preventDefault();
        if (hasUnsavedChanges && !isSaving) handleSave();
        return;
      }

      // Ctrl+Z -- Undo
      if (ctrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Ctrl+Shift+Z -- Redo
      if (ctrl && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        redo();
        return;
      }

      // Ctrl+Y -- Redo (alternative)
      if (ctrl && e.key === 'y') {
        e.preventDefault();
        redo();
        return;
      }

      // Delete / Backspace -- Delete selected node
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
        e.preventDefault();
        deleteNode(selectedNodeId);
        return;
      }

      // Escape -- Deselect / close panels
      if (e.key === 'Escape') {
        if (showNodeSearch) {
          setShowNodeSearch(false);
        } else if (selectedNodeId) {
          setSelectedNodeId(null);
        } else if (showCopilot) {
          setShowCopilot(false);
        } else if (showVariables) {
          setShowVariables(false);
        } else if (showVersions) {
          setShowVersions(false);
        }
        return;
      }

      // Ctrl+D -- Duplicate selected node
      if (ctrl && e.key === 'd' && selectedNodeId) {
        e.preventDefault();
        const node = nodes.find((n) => n.id === selectedNodeId);
        if (!node) return;

        nodeIdCounter.current += 1;
        const newId = `node_${nodeIdCounter.current}`;
        const newNode: Node = {
          id: newId,
          type: node.type,
          position: { x: node.position.x + 32, y: node.position.y + 32 },
          data: { ...node.data },
        };
        setNodes((nds) => [...nds, newNode]);
        setSelectedNodeId(newId);
        setHasUnsavedChanges(true);
        return;
      }

      // Ctrl+C -- Copy selected nodes
      if (ctrl && e.key === 'c') {
        const selected = nodes.filter((n) => n.selected);
        if (selected.length === 0) return;
        e.preventDefault();
        const selectedIds = new Set(selected.map((n) => n.id));
        const internalEdges = edges.filter(
          (ed) => selectedIds.has(ed.source) && selectedIds.has(ed.target)
        );
        // Store with relative positions (to center of selection)
        const avgX = selected.reduce((s, n) => s + n.position.x, 0) / selected.length;
        const avgY = selected.reduce((s, n) => s + n.position.y, 0) / selected.length;
        clipboardRef.current = {
          nodes: selected.map((n) => ({
            ...n,
            data: { ...n.data },
            position: { x: n.position.x - avgX, y: n.position.y - avgY },
          })),
          edges: internalEdges.map((ed) => ({ ...ed })),
        };
        return;
      }

      // Ctrl+V -- Paste copied nodes
      if (ctrl && e.key === 'v' && clipboardRef.current) {
        e.preventDefault();
        const clip = clipboardRef.current;
        const idMap = new Map<string, string>();
        const newNodes: Node[] = [];

        // Generate new IDs and offset positions
        for (const n of clip.nodes) {
          nodeIdCounter.current += 1;
          const newId = `node_${nodeIdCounter.current}`;
          idMap.set(n.id, newId);
          newNodes.push({
            ...n,
            id: newId,
            selected: true,
            position: { x: n.position.x + 400 + 50, y: n.position.y + 300 + 50 },
            data: { ...n.data },
          });
        }

        const newEdges: Edge[] = clip.edges.map((ed) => ({
          ...ed,
          id: `e_${idMap.get(ed.source) ?? ed.source}_${idMap.get(ed.target) ?? ed.target}`,
          source: idMap.get(ed.source) ?? ed.source,
          target: idMap.get(ed.target) ?? ed.target,
        }));

        pushHistory();
        // Deselect existing nodes
        setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), ...newNodes]);
        setEdges((eds) => [...eds, ...newEdges]);
        setHasUnsavedChanges(true);
        return;
      }

      // Ctrl+X -- Cut selected nodes
      if (ctrl && e.key === 'x') {
        const selected = nodes.filter((n) => n.selected);
        if (selected.length === 0) return;
        e.preventDefault();
        const selectedIds = new Set(selected.map((n) => n.id));
        const internalEdges = edges.filter(
          (ed) => selectedIds.has(ed.source) && selectedIds.has(ed.target)
        );
        const avgX = selected.reduce((s, n) => s + n.position.x, 0) / selected.length;
        const avgY = selected.reduce((s, n) => s + n.position.y, 0) / selected.length;
        clipboardRef.current = {
          nodes: selected.map((n) => ({
            ...n,
            data: { ...n.data },
            position: { x: n.position.x - avgX, y: n.position.y - avgY },
          })),
          edges: internalEdges.map((ed) => ({ ...ed })),
        };
        // Delete cut nodes
        pushHistory();
        setNodes((nds) => nds.filter((n) => !selectedIds.has(n.id)));
        setEdges((eds) =>
          eds.filter((ed) => !selectedIds.has(ed.source) && !selectedIds.has(ed.target))
        );
        setSelectedNodeId(null);
        setHasUnsavedChanges(true);
        return;
      }

      // Ctrl+K or "/" -- Open node search palette
      if ((ctrl && e.key === 'k') || (e.key === '/' && !ctrl)) {
        e.preventDefault();
        setShowNodeSearch(true);
        return;
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [
    hasUnsavedChanges,
    isSaving,
    handleSave,
    selectedNodeId,
    deleteNode,
    showCopilot,
    setShowCopilot,
    showVariables,
    setShowVariables,
    showVersions,
    setShowVersions,
    showNodeSearch,
    setShowNodeSearch,
    setHasUnsavedChanges,
    nodes,
    edges,
    setNodes,
    setEdges,
    setSelectedNodeId,
    nodeIdCounter,
    clipboardRef,
    undo,
    redo,
    pushHistory,
  ]);
}
