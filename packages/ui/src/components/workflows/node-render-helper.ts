// Shared render helper for workflow node component tests. We avoid
// @testing-library/react to keep the test setup minimal; nodes are rendered
// inside ReactFlowProvider and we assert on the resulting container's text
// content. This gives us broad coverage of label/data-driven rendering
// without coupling to a specific UI library version.

// @vitest-environment happy-dom

import { createElement, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { ReactFlowProvider } from '@xyflow/react';

export interface RenderNodeResult {
  container: HTMLDivElement;
  root: Root;
  text: () => string;
  cleanup: () => void;
}

export function renderWorkflowNode<P extends Record<string, unknown>>(
  Component: ComponentType<P>,
  props: P
): RenderNodeResult {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(createElement(ReactFlowProvider, null, createElement(Component, props)));
  });

  return {
    container,
    root,
    text: () => container.textContent ?? '',
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}
