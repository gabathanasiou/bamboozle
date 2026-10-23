import React, { useEffect, useRef, useState } from 'react';
import { Dice5, Expand, RotateCw, ScanLine } from 'lucide-react';
import type { DesignerConfig, DesignerDiagnostics, DesignerElementInfo, ResizeChange, SelectedStyleProperty } from './types';
import type { ParentToPreviewMessage, PreviewToParentMessage } from './bridge';
import { VIEWPORT_BY_PRESET, VIEWPORT_GROUPS } from './catalog';
import { breakpointForWidth } from './bridge';

interface PreviewFrameProps {
    config: DesignerConfig;
    onViewportChange: (width: number, height: number, preset: string) => void;
    onDiagnostics: (diagnostics: DesignerDiagnostics) => void;
    onElement: (element: DesignerElementInfo | null) => void;
    onError: (message: string) => void;
    onExportStatus: (status: 'started' | 'done' | 'error', message?: string) => void;
    onResizeChanges: (changes: ResizeChange[]) => void;
    onEditHistory: (history: { canUndo: boolean; canRedo: boolean }) => void;
    scanNonce: number;
    exportNonce: number;
    resetElementNonce: number;
    resetAllNonce: number;
    styleRequest: { property: SelectedStyleProperty; value: string; nonce: number } | null;
    historyAction: { action: 'undo' | 'redo'; nonce: number } | null;
    revealRequest: { selector: string; nonce: number } | null;
    onToggleInspect: () => void;
    onScan: () => void;
    onRandomize: () => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const ViewportSizeInput: React.FC<{
    label: string;
    value: number;
    min: number;
    max: number;
    onCommit: (value: number) => void;
}> = ({ label, value, min, max, onCommit }) => {
    const [draft, setDraft] = useState(String(value));

    useEffect(() => {
        setDraft(String(value));
    }, [value]);

    const commit = () => {
        const parsed = Number(draft);
        const next = draft.trim() !== '' && Number.isFinite(parsed) ? clamp(Math.round(parsed), min, max) : value;
        setDraft(String(next));
        if (next !== value) onCommit(next);
    };

    return (
        <input
            type="number"
            aria-label={label}
            title={label}
            value={draft}
            min={min}
            max={max}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') {
                    setDraft(String(value));
                    event.currentTarget.blur();
                }
            }}
            className="w-12 bg-transparent text-center font-mono text-[10px] text-slate-200 outline-none"
        />
    );
};

export const PreviewFrame: React.FC<PreviewFrameProps> = ({
    config,
    onViewportChange,
    onDiagnostics,
    onElement,
    onError,
    onExportStatus,
    onResizeChanges,
    onEditHistory,
    scanNonce,
    exportNonce,
    resetElementNonce,
    resetAllNonce,
    styleRequest,
    historyAction,
    revealRequest,
    onToggleInspect,
    onScan,
    onRandomize,
}) => {
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [ready, setReady] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [fit, setFit] = useState(true);
    const [scale, setScale] = useState(1);
    const [isResizing, setIsResizing] = useState(false);
    const [resizeAxis, setResizeAxis] = useState<'x' | 'y' | 'both' | null>(null);
    const dragRef = useRef<{
        axis: 'x' | 'y' | 'both';
        startX: number;
        startY: number;
        startWidth: number;
        startHeight: number;
    } | null>(null);

    const post = (message: ParentToPreviewMessage) => {
        iframeRef.current?.contentWindow?.postMessage(message, window.location.origin);
    };

    useEffect(() => {
        const handleMessage = (event: MessageEvent<PreviewToParentMessage>) => {
            if (event.origin !== window.location.origin) return;
            if (event.source !== iframeRef.current?.contentWindow) return;
            const message = event.data;
            if (!message || typeof message !== 'object') return;
            switch (message.type) {
                case 'designer:ready':
                    setReady(true);
                    setLoadError(null);
                    break;
                case 'designer:diagnostics':
                    onDiagnostics(message.diagnostics);
                    break;
                case 'designer:element':
                    onElement(message.element);
                    break;
                case 'designer:error':
                    setLoadError(message.message);
                    onError(message.message);
                    break;
                case 'designer:export-status':
                    onExportStatus(message.status, message.message);
                    break;
                case 'designer:resize-changes':
                    onResizeChanges(message.changes);
                    break;
                case 'designer:edit-history':
                    onEditHistory({ canUndo: message.canUndo, canRedo: message.canRedo });
                    break;
                default:
                    break;
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [onDiagnostics, onElement, onError, onExportStatus, onResizeChanges, onEditHistory]);

    useEffect(() => {
        if (!ready) return;
        post({ type: 'designer:config', config });
    }, [config, ready]);

    useEffect(() => {
        if (!ready || scanNonce <= 0) return;
        post({ type: 'designer:scan' });
    }, [scanNonce, ready]);

    useEffect(() => {
        if (!ready || exportNonce <= 0) return;
        post({ type: 'designer:export-png' });
    }, [exportNonce, ready]);

    useEffect(() => {
        if (!ready || resetElementNonce <= 0) return;
        post({ type: 'designer:reset-element-size' });
    }, [ready, resetElementNonce]);

    useEffect(() => {
        if (!ready || resetAllNonce <= 0) return;
        post({ type: 'designer:reset-all-element-sizes' });
    }, [ready, resetAllNonce]);

    useEffect(() => {
        if (!ready || !styleRequest) return;
        post({ type: 'designer:set-selected-style', property: styleRequest.property, value: styleRequest.value });
    }, [ready, styleRequest]);

    useEffect(() => {
        if (!ready || !historyAction) return;
        post({ type: 'designer:history-action', action: historyAction.action });
    }, [ready, historyAction]);

    useEffect(() => {
        if (!ready || !revealRequest) return;
        post({ type: 'designer:reveal-element', selector: revealRequest.selector });
    }, [ready, revealRequest]);

    useEffect(() => {
        const measure = () => {
            if (isResizing) return;
            const element = containerRef.current;
            if (!element) return;
            if (!fit) {
                setScale(1);
                return;
            }
            const padding = 72;
            const next = Math.min(
                1,
                Math.max(0.1, (element.clientWidth - padding) / config.viewport.width),
                Math.max(0.1, (element.clientHeight - padding) / config.viewport.height),
            );
            setScale(next);
        };
        measure();
        const observer = new ResizeObserver(measure);
        if (containerRef.current) observer.observe(containerRef.current);
        window.addEventListener('resize', measure);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', measure);
        };
    }, [fit, isResizing, config.viewport.width, config.viewport.height]);

    const beginResize = (axis: 'x' | 'y' | 'both') => (event: React.PointerEvent) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const startScale = scale;
        setIsResizing(true);
        setResizeAxis(axis);
        dragRef.current = {
            axis,
            startX: event.clientX,
            startY: event.clientY,
            startWidth: config.viewport.width,
            startHeight: config.viewport.height,
        };
        const move = (moveEvent: PointerEvent) => {
            const drag = dragRef.current;
            if (!drag) return;
            const dx = (moveEvent.clientX - drag.startX) / startScale;
            const dy = (moveEvent.clientY - drag.startY) / startScale;
            const width = drag.axis === 'y' ? drag.startWidth : drag.startWidth + dx;
            const height = drag.axis === 'x' ? drag.startHeight : drag.startHeight + dy;
            onViewportChange(clamp(Math.round(width), 320, 3840), clamp(Math.round(height), 320, 2160), 'custom');
        };
        const stop = () => {
            dragRef.current = null;
            setIsResizing(false);
            setResizeAxis(null);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', stop);
            window.removeEventListener('pointercancel', stop);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop, { once: true });
        window.addEventListener('pointercancel', stop, { once: true });
    };

    useEffect(() => {
        if (!isResizing) return;
        const cursor = resizeAxis === 'y' ? 'ns-resize' : resizeAxis === 'x' ? 'ew-resize' : 'nwse-resize';
        const previousCursor = document.body.style.cursor;
        const previousSelect = document.body.style.userSelect;
        document.body.style.cursor = cursor;
        document.body.style.userSelect = 'none';
        return () => {
            document.body.style.cursor = previousCursor;
            document.body.style.userSelect = previousSelect;
        };
    }, [isResizing, resizeAxis]);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-black/20 px-4 py-2">
                <div className="flex flex-wrap items-center gap-2">
                    <select
                        value={config.viewport.preset}
                        onChange={(event) => {
                            const preset = event.target.value;
                            if (preset === 'custom') {
                                onViewportChange(config.viewport.width, config.viewport.height, 'custom');
                                return;
                            }
                            const next = VIEWPORT_BY_PRESET[preset];
                            if (next) onViewportChange(next.width, next.height, next.preset);
                        }}
                        aria-label="Viewport preset"
                        title="Viewport preset"
                        className="max-w-[280px] rounded-md border border-white/10 bg-[#111827] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-200 outline-none focus:border-yellow-400/60"
                    >
                        {VIEWPORT_GROUPS.map((group) => (
                            <optgroup key={group.label} label={group.label}>
                                {group.options.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </optgroup>
                        ))}
                        <optgroup label="Custom">
                            <option value="custom">Custom size</option>
                        </optgroup>
                    </select>
                    <div
                        className="flex items-center gap-0.5 rounded-md border border-white/10 bg-white/5 px-1 py-0.5"
                        title="Live element edits persist when you switch viewport. Reset all restores the natural layout."
                    >
                        <ViewportSizeInput
                            label="Viewport width"
                            value={config.viewport.width}
                            min={320}
                            max={3840}
                            onCommit={(width) => onViewportChange(width, config.viewport.height, 'custom')}
                        />
                        <span className="text-[9px] text-slate-600">×</span>
                        <ViewportSizeInput
                            label="Viewport height"
                            value={config.viewport.height}
                            min={320}
                            max={2160}
                            onCommit={(height) => onViewportChange(config.viewport.width, height, 'custom')}
                        />
                    </div>
                    <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[9px] text-slate-500">{breakpointForWidth(config.viewport.width)}</span>
                    <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[9px] text-slate-500">{Math.round(scale * 100)}%</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => setFit((value) => !value)}
                        className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-bold uppercase tracking-wide ${fit ? 'border-yellow-400/30 bg-yellow-400/10 text-yellow-300' : 'border-white/10 bg-white/5 text-slate-400'}`}
                        title="Fit frame to canvas"
                    >
                        <Expand size={12} /> {fit ? 'Fit' : '100%'}
                    </button>
                    <button
                        type="button"
                        onClick={() => onViewportChange(config.viewport.height, config.viewport.width, 'custom')}
                        className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-slate-400 hover:bg-white/10"
                        title="Rotate viewport"
                    >
                        <RotateCw size={12} /> Rotate
                    </button>
                    <button
                        type="button"
                        onClick={onToggleInspect}
                        className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-bold uppercase tracking-wide ${config.preview.inspect ? 'border-blue-400/40 bg-blue-400/10 text-blue-300' : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'}`}
                        title="Toggle hover inspector"
                    >
                        <ScanLine size={12} /> Inspect
                    </button>
                    <button
                        type="button"
                        onClick={onScan}
                        className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-slate-400 hover:bg-white/10"
                        title="Re-scan layout"
                    >
                        Scan
                    </button>
                    <button
                        type="button"
                        onClick={onRandomize}
                        className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-slate-400 hover:bg-white/10"
                        title="Randomize fixture state"
                    >
                        <Dice5 size={12} /> Random
                    </button>
                </div>
            </div>

            <div ref={containerRef} className="relative min-h-0 flex-1 overflow-auto bg-[#070b12] p-6">
                <div
                    className="relative mx-auto my-2"
                    style={{ width: config.viewport.width * scale, height: config.viewport.height * scale }}
                >
                    <div
                        className="absolute left-0 top-0 origin-top-left overflow-hidden rounded-xl border border-white/15 bg-[#1a0b2e] shadow-2xl shadow-black/60"
                        style={{ width: config.viewport.width, height: config.viewport.height, transform: `scale(${scale})` }}
                    >
                        <iframe
                            ref={iframeRef}
                            src="/designer/preview"
                            title="Design lab live preview"
                            data-testid="designer-preview"
                            onLoad={() => setLoadError(null)}
                            className={`h-full w-full border-0 bg-[#1a0b2e] ${isResizing ? 'pointer-events-none' : ''}`}
                        />
                        {!ready && !loadError && (
                            <div className="absolute inset-0 flex items-center justify-center bg-[#1a0b2e] text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
                                Loading real app preview…
                            </div>
                        )}
                        {loadError && (
                            <div className="absolute inset-0 flex items-center justify-center bg-red-950/90 p-6 text-center text-xs text-red-100">
                                Preview error: {loadError}
                            </div>
                        )}
                    </div>

                    <div
                        onPointerDown={beginResize('x')}
                        className="absolute -right-2 top-8 bottom-8 z-20 w-3 cursor-ew-resize touch-none rounded-full bg-white/0 hover:bg-yellow-400/50"
                        title="Drag to resize width"
                    />
                    <div
                        onPointerDown={beginResize('y')}
                        className="absolute -bottom-2 left-8 right-8 z-20 h-3 cursor-ns-resize touch-none rounded-full bg-white/0 hover:bg-yellow-400/50"
                        title="Drag to resize height"
                    />
                    <div
                        onPointerDown={beginResize('both')}
                        className="absolute -bottom-2 -right-2 z-20 h-5 w-5 cursor-nwse-resize touch-none rounded-md bg-yellow-400/80 shadow-lg shadow-black/40"
                        title="Drag to resize"
                    />
                    {isResizing && (
                        <div className="pointer-events-none absolute -top-8 left-0 z-30 rounded-md border border-yellow-400/40 bg-black/80 px-2 py-1 font-mono text-[10px] text-yellow-300 shadow-lg">
                            {config.viewport.width}×{config.viewport.height}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
