/**
 * WorkflowCanvas — ReactFlow canvas with drag/drop support.
 */

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Connection,
  type Edge,
  type Node,
  type OnNodesChange,
  type OnEdgesChange,
} from '@xyflow/react';

import { nodeTypes, defaultEdgeOptions } from './shared';

export interface WorkflowCanvasProps {
  nodes: Node[];
  edges: Edge[];
  isExecuting: boolean;
  onNodesChange: OnNodesChange<Node>;
  onEdgesChange: OnEdgesChange<Edge>;
  onConnect: (connection: Connection) => void;
  isValidConnection: (connection: Edge | Connection) => boolean;
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  onPaneClick: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

export function WorkflowCanvas({
  nodes,
  edges,
  isExecuting,
  onNodesChange,
  onEdgesChange,
  onConnect,
  isValidConnection,
  onNodeClick,
  onPaneClick,
  onDragOver,
  onDrop,
}: WorkflowCanvasProps) {
  return (
    <div className="flex-1 relative" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        snapToGrid
        snapGrid={[16, 16]}
        nodesDraggable={!isExecuting}
        nodesConnectable={!isExecuting}
        elementsSelectable={!isExecuting}
        deleteKeyCode={isExecuting ? null : 'Delete'}
        className="bg-bg-primary dark:bg-dark-bg-primary"
      >
        <Background gap={16} size={1} />
        <Controls
          showInteractive={false}
          className="!bg-bg-secondary dark:!bg-dark-bg-secondary !border-border dark:!border-dark-border !shadow-sm"
        />
        <MiniMap
          nodeStrokeWidth={3}
          className="!bg-bg-secondary dark:!bg-dark-bg-secondary !border-border dark:!border-dark-border"
        />
      </ReactFlow>

      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-text-muted dark:text-dark-text-muted text-sm">
            Drag tools from the left panel to start building your workflow
          </p>
        </div>
      )}
    </div>
  );
}
