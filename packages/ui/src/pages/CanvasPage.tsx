/**
 * CanvasPage (Live Canvas)
 *
 * Agent-driven spatial visual workspace, editable by the user too. Elements are
 * placed/moved/updated by the agent through canvas tools OR directly here; the
 * page applies incremental `canvas:op` WebSocket events live and supports
 * multiple named canvases, drag-to-move, resize, inline edit, add and delete.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { EmptyState } from '../components/EmptyState';
import { MarkdownContent } from '../components/MarkdownContent';
import {
  LayoutTemplate,
  StickyNote,
  Image,
  Square,
  Hash,
  Type,
  RotateCcw,
  Trash2,
  Plus,
  X,
} from '../components/icons';
import { canvasApi } from '../api/endpoints/canvas';
import type { CanvasElement, CanvasElementType } from '../api/endpoints/canvas';
import { useGateway } from '../hooks/useWebSocket';
import { safeImageSrc } from '../components/widgets/media-url';

interface CanvasOpPayload {
  canvasId: string;
  action: 'add' | 'update' | 'move' | 'remove' | 'clear';
  element?: CanvasElement;
  id?: string;
}

const MIN_W = 80;
const MIN_H = 60;

function elementIcon(type: CanvasElementType) {
  switch (type) {
    case 'note':
      return <StickyNote className="w-3.5 h-3.5" />;
    case 'image':
      return <Image className="w-3.5 h-3.5" />;
    case 'shape':
      return <Square className="w-3.5 h-3.5" />;
    case 'heading':
      return <Hash className="w-3.5 h-3.5" />;
    default:
      return <Type className="w-3.5 h-3.5" />;
  }
}

function ElementBody({ el }: { el: CanvasElement }) {
  if (el.type === 'image') {
    const src = safeImageSrc(el.content);
    if (!src) {
      return (
        <div className="flex h-full w-full items-center justify-center text-xs text-text-muted">
          Blocked image URL
        </div>
      );
    }
    return (
      <img
        src={src}
        alt=""
        className="w-full h-full object-contain"
        onError={(e) => {
          (e.target as HTMLImageElement).style.opacity = '0.3';
        }}
      />
    );
  }
  if (el.type === 'html') {
    return (
      <iframe
        title={el.id}
        srcDoc={el.content}
        sandbox="allow-scripts"
        className="w-full h-full border-0 bg-white"
      />
    );
  }
  if (el.type === 'shape') {
    return <div className="w-full h-full" />;
  }
  if (el.type === 'markdown') {
    return <MarkdownContent content={el.content} className="text-sm" />;
  }
  if (el.type === 'heading') {
    return (
      <div className="font-semibold text-lg whitespace-pre-wrap break-words">{el.content}</div>
    );
  }
  return <div className="text-sm whitespace-pre-wrap break-words">{el.content}</div>;
}

export function CanvasPage() {
  const { subscribe } = useGateway();
  const [canvasId, setCanvasId] = useState('main');
  const [canvases, setCanvases] = useState<Array<{ canvasId: string; count: number }>>([]);
  const [elements, setElements] = useState<CanvasElement[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const dragRef = useRef<{
    id: string;
    px: number;
    py: number;
    ox: number;
    oy: number;
    x: number;
    y: number;
  } | null>(null);
  const resizeRef = useRef<{
    id: string;
    px: number;
    py: number;
    ow: number;
    oh: number;
    w: number;
    h: number;
  } | null>(null);

  const loadCanvases = useCallback(async () => {
    try {
      const data = await canvasApi.listCanvases();
      setCanvases(data?.canvases ?? [{ canvasId: 'main', count: 0 }]);
    } catch {
      /* reported by client */
    }
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await canvasApi.listElements(canvasId);
      setElements(data?.elements ?? []);
    } catch {
      /* reported by client */
    } finally {
      setIsLoading(false);
    }
  }, [canvasId]);

  useEffect(() => {
    loadCanvases();
  }, [loadCanvases]);

  useEffect(() => {
    load();
  }, [load]);

  // Apply incremental canvas operations live (only for the active canvas)
  useEffect(() => {
    const unsub = subscribe<CanvasOpPayload>('canvas:op', (payload) => {
      if (payload.canvasId !== canvasId) {
        loadCanvases();
        return;
      }
      setElements((prev) => {
        switch (payload.action) {
          case 'clear':
            return [];
          case 'remove':
            return prev.filter((e) => e.id !== payload.id);
          case 'add':
          case 'update':
          case 'move': {
            if (!payload.element) return prev;
            const el = payload.element;
            // Don't let an echoed move/resize clobber an element we're manipulating.
            if (
              (payload.action === 'move' || payload.action === 'update') &&
              (dragRef.current?.id === el.id || resizeRef.current?.id === el.id)
            ) {
              return prev;
            }
            const exists = prev.some((e) => e.id === el.id);
            const next = exists ? prev.map((e) => (e.id === el.id ? el : e)) : [...prev, el];
            return next.sort((a, b) => a.z - b.z);
          }
          default:
            return prev;
        }
      });
      loadCanvases();
    });
    return () => unsub();
  }, [subscribe, canvasId, loadCanvases]);

  const handleClear = async () => {
    if (!window.confirm(`Clear all elements on "${canvasId}"?`)) return;
    try {
      await canvasApi.clear(canvasId);
      setElements([]);
    } catch {
      /* reported by client */
    }
  };

  const addElement = async (type: CanvasElementType) => {
    const offset = elements.length * 24;
    const content =
      type === 'heading'
        ? 'Heading'
        : type === 'note'
          ? 'New note'
          : type === 'shape'
            ? ''
            : type === 'image'
              ? 'https://'
              : 'Text';
    const style =
      type === 'note'
        ? { background: '#fef3c7' }
        : type === 'shape'
          ? { background: '#bfdbfe' }
          : null;
    try {
      await canvasApi.create(canvasId, {
        type,
        x: 80 + (offset % 400),
        y: 80 + (offset % 300),
        content,
        style,
      });
      // WS 'add' echo inserts it live.
    } catch {
      /* reported by client */
    }
  };

  const removeElement = async (id: string) => {
    setElements((prev) => prev.filter((e) => e.id !== id));
    try {
      await canvasApi.remove(canvasId, id);
    } catch {
      load();
    }
  };

  const beginEdit = (el: CanvasElement) => {
    setEditingId(el.id);
    setEditValue(el.content);
  };

  const saveEdit = async (id: string) => {
    const value = editValue;
    setEditingId(null);
    setElements((prev) => prev.map((e) => (e.id === id ? { ...e, content: value } : e)));
    try {
      await canvasApi.update(canvasId, id, { content: value });
    } catch {
      load();
    }
  };

  const startDrag = useCallback(
    (e: React.PointerEvent, el: CanvasElement) => {
      e.preventDefault();
      dragRef.current = {
        id: el.id,
        px: e.clientX,
        py: e.clientY,
        ox: el.x,
        oy: el.y,
        x: el.x,
        y: el.y,
      };
      setDraggingId(el.id);
      const onMove = (ev: PointerEvent) => {
        const d = dragRef.current;
        if (!d) return;
        d.x = d.ox + (ev.clientX - d.px);
        d.y = d.oy + (ev.clientY - d.py);
        setElements((prev) => prev.map((p) => (p.id === d.id ? { ...p, x: d.x, y: d.y } : p)));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const d = dragRef.current;
        dragRef.current = null;
        setDraggingId(null);
        if (d && (d.x !== d.ox || d.y !== d.oy)) {
          canvasApi.move(d.id, Math.round(d.x), Math.round(d.y), canvasId).catch(() => load());
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [canvasId, load]
  );

  const startResize = useCallback(
    (e: React.PointerEvent, el: CanvasElement) => {
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = {
        id: el.id,
        px: e.clientX,
        py: e.clientY,
        ow: el.w,
        oh: el.h,
        w: el.w,
        h: el.h,
      };
      setResizingId(el.id);
      const onMove = (ev: PointerEvent) => {
        const r = resizeRef.current;
        if (!r) return;
        r.w = Math.max(MIN_W, r.ow + (ev.clientX - r.px));
        r.h = Math.max(MIN_H, r.oh + (ev.clientY - r.py));
        setElements((prev) => prev.map((p) => (p.id === r.id ? { ...p, w: r.w, h: r.h } : p)));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const r = resizeRef.current;
        resizeRef.current = null;
        setResizingId(null);
        if (r && (r.w !== r.ow || r.h !== r.oh)) {
          canvasApi
            .update(canvasId, r.id, { w: Math.round(r.w), h: Math.round(r.h) })
            .catch(() => load());
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [canvasId, load]
  );

  const newCanvas = () => {
    const name = window.prompt('New canvas name (letters, digits, dashes):', '');
    if (!name) return;
    const id = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-');
    if (!id) return;
    setCanvases((prev) =>
      prev.some((c) => c.canvasId === id) ? prev : [...prev, { canvasId: id, count: 0 }]
    );
    setCanvasId(id);
  };

  const ADD_BUTTONS: Array<{ type: CanvasElementType; label: string }> = [
    { type: 'note', label: 'Note' },
    { type: 'heading', label: 'Heading' },
    { type: 'text', label: 'Text' },
    { type: 'shape', label: 'Shape' },
    { type: 'markdown', label: 'Markdown' },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <LayoutTemplate className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-semibold">Live Canvas</h1>
          <select
            value={canvasId}
            onChange={(e) => setCanvasId(e.target.value)}
            className="ml-2 text-sm rounded-md border border-border bg-background px-2 py-1"
          >
            {canvases.map((c) => (
              <option key={c.canvasId} value={c.canvasId}>
                {c.canvasId} ({c.count})
              </option>
            ))}
            {!canvases.some((c) => c.canvasId === canvasId) && (
              <option value={canvasId}>{canvasId} (0)</option>
            )}
          </select>
          <button
            onClick={newCanvas}
            className="inline-flex items-center gap-1 px-2 py-1 text-sm rounded-md border border-border hover:bg-muted"
            title="New canvas"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {ADD_BUTTONS.map((b) => (
            <button
              key={b.type}
              onClick={() => addElement(b.type)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-md border border-border hover:bg-muted"
            >
              <Plus className="w-3.5 h-3.5" />
              {b.label}
            </button>
          ))}
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border hover:bg-muted"
          >
            <RotateCcw className="w-4 h-4" />
            Refresh
          </button>
          <button
            onClick={handleClear}
            disabled={elements.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border hover:bg-destructive/10 text-destructive disabled:opacity-40"
          >
            <Trash2 className="w-4 h-4" />
            Clear
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-auto bg-muted/30">
        {isLoading ? (
          <div className="p-8 text-sm text-muted-foreground">Loading canvas…</div>
        ) : elements.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <EmptyState
              icon={LayoutTemplate}
              title="Canvas is empty"
              description="Add elements with the toolbar above, or ask the assistant — notes, headings, images, and shapes appear here live."
            />
          </div>
        ) : (
          <div className="relative" style={{ minWidth: 2000, minHeight: 1500 }}>
            {elements.map((el) => (
              <div
                key={el.id}
                className={`absolute rounded-md border bg-card shadow-sm overflow-hidden ${
                  draggingId === el.id || resizingId === el.id
                    ? 'border-primary shadow-lg ring-1 ring-primary/40 select-none'
                    : 'border-border'
                }`}
                style={{
                  left: el.x,
                  top: el.y,
                  width: el.w,
                  height: el.h,
                  zIndex: draggingId === el.id || resizingId === el.id ? 9999 : el.z,
                  ...(el.style as React.CSSProperties),
                }}
              >
                <div className="flex items-center justify-between gap-1 border-b border-border/60 bg-muted/40">
                  <div
                    onPointerDown={(e) => startDrag(e, el)}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground cursor-grab active:cursor-grabbing flex-1"
                    title="Drag to move"
                  >
                    {elementIcon(el.type)}
                    <span>{el.type}</span>
                  </div>
                  <button
                    onClick={() => removeElement(el.id)}
                    className="px-1.5 py-1 text-muted-foreground hover:text-destructive"
                    title="Delete element"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div
                  className="p-2 w-full h-[calc(100%-1.5rem)] overflow-auto"
                  onDoubleClick={() => {
                    if (el.type !== 'shape') beginEdit(el);
                  }}
                  title={el.type !== 'shape' ? 'Double-click to edit' : undefined}
                >
                  {editingId === el.id ? (
                    <textarea
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => saveEdit(el.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setEditingId(null);
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit(el.id);
                      }}
                      className="w-full h-full resize-none text-sm bg-transparent outline-none"
                    />
                  ) : (
                    <ElementBody el={el} />
                  )}
                </div>

                {/* Resize handle */}
                <div
                  onPointerDown={(e) => startResize(e, el)}
                  className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize"
                  style={{
                    background:
                      'linear-gradient(135deg, transparent 50%, var(--color-border, #888) 50%)',
                  }}
                  title="Drag to resize"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
