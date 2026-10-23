import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { toPng } from 'html-to-image';
import { OnlinePlayerView } from '../views/OnlinePlayerView';
import { HostView } from '../views/HostView';
import { PlayerView } from '../views/PlayerView';
import { HomeView } from '../views/HomeView';
import { OfflineView } from '../views/OfflineView';
import { SettingsView } from '../views/SettingsView';
import { AdminView } from '../views/AdminView';
import { RoomManagerModal } from '../views/GameSharedComponents';
import { sfx } from '../services/audioService';
import { buildPreviewModel, createPreviewActions } from './fixtures';
import { describeElement, revealElement, scanLayout } from './diagnostics';
import { breakpointForWidth, normaliseConfig } from './bridge';
import type {
    DesignerConfig,
    DesignerDiagnostics,
    DesignerElementInfo,
    ElementSnapshot,
    PreviewModel,
    ResizeChange,
} from './types';
import type { ParentToPreviewMessage, PreviewToParentMessage } from './bridge';

const ROOT_ID = 'designer-preview-root';
type StylePatch = Partial<Record<
    'width' | 'height' | 'minWidth' | 'minHeight' | 'maxWidth' | 'maxHeight' | 'flex' | 'boxSizing' | 'fontSize' | 'lineHeight',
    string
>>;
const MANAGED_STYLE_KEYS: Array<keyof StylePatch> = [
    'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'flex', 'boxSizing', 'fontSize', 'lineHeight',
];
const noop = () => undefined;
const actions = createPreviewActions();

class PreviewErrorBoundary extends React.Component<
    { children: React.ReactNode; onError: (message: string) => void },
    { error: Error | null }
> {
    state = { error: null as Error | null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    componentDidCatch(error: Error) {
        this.props.onError(error.message);
    }

    render() {
        if (this.state.error) {
            return (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-red-950 p-8 text-center text-red-100">
                    <div className="text-sm font-black uppercase tracking-widest">Preview render error</div>
                    <pre className="max-w-full overflow-auto whitespace-pre-wrap text-xs text-red-200/80">{this.state.error.message}</pre>
                </div>
            );
        }
        return this.props.children;
    }
}

export const PreviewSurface: React.FC = () => {
    const [config, setConfig] = useState<DesignerConfig>(() => normaliseConfig());
    const [diagnostics, setDiagnostics] = useState<DesignerDiagnostics | null>(null);
    const [selected, setSelected] = useState<DesignerElementInfo | null>(null);
    const [hoverRect, setHoverRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
    const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const configRef = useRef(config);
    const diagnosticsRef = useRef(diagnostics);
    const originalStylesRef = useRef<Map<string, Record<string, string>>>(new Map());
    const resizeChangesRef = useRef<Map<string, ResizeChange>>(new Map());
    const resizeBaselinesRef = useRef<Map<string, ElementSnapshot>>(new Map());
    const editStateRef = useRef<Map<string, StylePatch>>(new Map());
    const editHistoryRef = useRef<Array<Map<string, StylePatch>>>([new Map()]);
    const editHistoryIndexRef = useRef(0);
    const editHistoryTimerRef = useRef<number | null>(null);

    useEffect(() => {
        configRef.current = config;
    }, [config]);

    useEffect(() => {
        diagnosticsRef.current = diagnostics;
    }, [diagnostics]);

    const post = useCallback((message: PreviewToParentMessage) => {
        window.parent.postMessage(message, window.location.origin);
    }, []);

    const reportError = useCallback((message: string) => {
        setError(message);
        post({ type: 'designer:error', message });
    }, [post]);

    const scan = useCallback(() => {
        const next = scanLayout(configRef.current);
        setDiagnostics(next);
        post({ type: 'designer:diagnostics', diagnostics: next });
    }, [post]);

    const snapshotElement = useCallback((element: HTMLElement): ElementSnapshot => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return {
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
        };
    }, []);

    const getSimilarTargets = useCallback((element: HTMLElement): HTMLElement[] => {
        if (!configRef.current.preview.applyToSimilar) return [element];
        const className = typeof element.className === 'string' ? element.className.trim() : '';
        if (!className) return [element];
        const appRoot = document.querySelector<HTMLElement>('[data-designer-app]');
        if (!appRoot) return [element];
        const matches = Array.from(appRoot.querySelectorAll<HTMLElement>(element.tagName))
            .filter((candidate) => {
                if (candidate === element) return true;
                if (candidate.className !== element.className) return false;
                const rect = candidate.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            });
        return matches.slice(0, 24);
    }, []);

    const captureTarget = useCallback((element: HTMLElement) => {
        const selector = describeElement(element).selector;
        if (!originalStylesRef.current.has(selector)) {
            originalStylesRef.current.set(selector, {
                width: element.style.width,
                height: element.style.height,
                minWidth: element.style.minWidth,
                minHeight: element.style.minHeight,
                maxWidth: element.style.maxWidth,
                maxHeight: element.style.maxHeight,
                flex: element.style.flex,
                boxSizing: element.style.boxSizing,
                fontSize: element.style.fontSize,
                lineHeight: element.style.lineHeight,
            });
        }
        if (!resizeBaselinesRef.current.has(selector)) {
            resizeBaselinesRef.current.set(selector, snapshotElement(element));
        }
        return { element, selector };
    }, [snapshotElement]);

    const postEditHistory = useCallback(() => {
        post({
            type: 'designer:edit-history',
            canUndo: editHistoryIndexRef.current > 0,
            canRedo: editHistoryIndexRef.current < editHistoryRef.current.length - 1,
        });
    }, [post]);

    const cloneEditState = (state: Map<string, StylePatch>) => new Map(
        Array.from(state.entries()).map(([selector, patch]) => [selector, { ...patch }]),
    );

    const serializeEditState = (state: Map<string, StylePatch>) => JSON.stringify(
        Array.from(state.entries()).sort(([a], [b]) => a.localeCompare(b)),
    );

    const refreshResizeChanges = useCallback(() => {
        const next = new Map<string, ResizeChange>();
        const seenGroups = new Set<string>();
        const entries = Array.from(editStateRef.current.keys()).map((selector) => {
            const element = document.querySelector<HTMLElement>(selector);
            if (!element) return null;
            const info = describeElement(element);
            return { selector, element, info, groupKey: `${info.tag}|${info.classes}` };
        }).filter((entry): entry is { selector: string; element: HTMLElement; info: DesignerElementInfo; groupKey: string } => !!entry);

        entries.forEach(({ selector, element, info, groupKey }) => {
            if (seenGroups.has(groupKey)) return;
            const before = resizeBaselinesRef.current.get(selector);
            if (!before) return;
            seenGroups.add(groupKey);
            const after = snapshotElement(element);
            if (
                before.width === after.width
                && before.height === after.height
                && before.fontSize === after.fontSize
                && before.lineHeight === after.lineHeight
            ) {
                return;
            }
            const similarCount = entries.filter((entry) => entry.groupKey === groupKey).length;
            const text = info.text || (element.hasAttribute('data-design-avatar') ? 'Avatar' : '');
            next.set(selector, {
                selector,
                label: text || info.tag,
                classes: info.classes,
                text,
                similarCount,
                before,
                after,
                viewport: {
                    width: window.innerWidth,
                    height: window.innerHeight,
                    breakpoint: breakpointForWidth(window.innerWidth),
                },
            });
        });
        resizeChangesRef.current = next;
        post({ type: 'designer:resize-changes', changes: Array.from(next.values()) });
    }, [post, snapshotElement]);

    const applyEditState = useCallback((state: Map<string, StylePatch>) => {
        const selectors = new Set([...editStateRef.current.keys(), ...state.keys()]);
        selectors.forEach((selector) => {
            const element = document.querySelector<HTMLElement>(selector);
            if (!element) return;
            const original = originalStylesRef.current.get(selector);
            if (original) {
                Object.entries(original).forEach(([key, value]) => {
                    element.style.setProperty(key, value);
                });
            } else {
                MANAGED_STYLE_KEYS.forEach((key) => {
                    element.style.removeProperty(key);
                });
            }
            const patch = state.get(selector);
            if (patch) {
                Object.entries(patch).forEach(([key, value]) => {
                    element.style.setProperty(key, value, key === 'width' || key === 'height' ? 'important' : '');
                });
            }
        });
        editStateRef.current = cloneEditState(state);
    }, []);

    const commitEditHistory = useCallback(() => {
        if (editHistoryTimerRef.current) {
            window.clearTimeout(editHistoryTimerRef.current);
            editHistoryTimerRef.current = null;
        }
        const current = cloneEditState(editStateRef.current);
        const last = editHistoryRef.current[editHistoryIndexRef.current];
        if (last && serializeEditState(last) === serializeEditState(current)) return;
        const next = editHistoryRef.current.slice(0, editHistoryIndexRef.current + 1);
        next.push(current);
        if (next.length > 100) next.shift();
        editHistoryRef.current = next;
        editHistoryIndexRef.current = next.length - 1;
        postEditHistory();
    }, [postEditHistory]);

    const scheduleEditHistory = useCallback(() => {
        if (editHistoryTimerRef.current) window.clearTimeout(editHistoryTimerRef.current);
        editHistoryTimerRef.current = window.setTimeout(() => {
            editHistoryTimerRef.current = null;
            commitEditHistory();
        }, 350);
    }, [commitEditHistory]);

    const undoEdit = useCallback(() => {
        commitEditHistory();
        const index = editHistoryIndexRef.current;
        if (index <= 0) return;
        const nextIndex = index - 1;
        const snapshot = editHistoryRef.current[nextIndex];
        editHistoryIndexRef.current = nextIndex;
        applyEditState(snapshot);
        refreshResizeChanges();
        postEditHistory();
        const selector = selected?.selector;
        if (selector) {
            const element = document.querySelector<HTMLElement>(selector);
            if (element) {
                const info = describeElement(element);
                setSelected(info);
                post({ type: 'designer:element', element: info });
            }
        }
    }, [applyEditState, commitEditHistory, post, postEditHistory, refreshResizeChanges, selected?.selector]);

    const redoEdit = useCallback(() => {
        commitEditHistory();
        const index = editHistoryIndexRef.current;
        if (index >= editHistoryRef.current.length - 1) return;
        const nextIndex = index + 1;
        const snapshot = editHistoryRef.current[nextIndex];
        editHistoryIndexRef.current = nextIndex;
        applyEditState(snapshot);
        refreshResizeChanges();
        postEditHistory();
        const selector = selected?.selector;
        if (selector) {
            const element = document.querySelector<HTMLElement>(selector);
            if (element) {
                const info = describeElement(element);
                setSelected(info);
                post({ type: 'designer:element', element: info });
            }
        }
    }, [applyEditState, commitEditHistory, post, postEditHistory, refreshResizeChanges, selected?.selector]);

    const resetSelectedSize = useCallback(() => {
        const selector = selected?.selector;
        if (!selector) return;
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) return;
        const targets = getSimilarTargets(element).map(captureTarget);
        targets.forEach(({ element: target, selector: targetSelector }) => {
            const original = originalStylesRef.current.get(targetSelector);
            if (original) {
                Object.entries(original).forEach(([key, value]) => {
                    target.style.setProperty(key, value);
                });
            } else {
                MANAGED_STYLE_KEYS.forEach((key) => {
                    target.style.removeProperty(key);
                });
            }
            editStateRef.current.delete(targetSelector);
        });
        refreshResizeChanges();
        commitEditHistory();
        const info = describeElement(element);
        setSelected(info);
        post({ type: 'designer:element', element: info });
    }, [captureTarget, commitEditHistory, getSimilarTargets, post, refreshResizeChanges, selected?.selector]);

    const resetAllSizes = useCallback(() => {
        applyEditState(new Map());
        refreshResizeChanges();
        commitEditHistory();
        const selector = selected?.selector;
        if (selector) {
            const element = document.querySelector<HTMLElement>(selector);
            if (element) {
                const info = describeElement(element);
                setSelected(info);
                post({ type: 'designer:element', element: info });
            }
        }
    }, [applyEditState, commitEditHistory, post, refreshResizeChanges, selected?.selector]);

    const setSelectedStyle = useCallback((property: 'fontSize' | 'lineHeight', value: string) => {
        const selector = selected?.selector;
        if (!selector) return;
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) return;
        const targets = getSimilarTargets(element).map(captureTarget);
        targets.forEach(({ element: target, selector: targetSelector }) => {
            if (property === 'fontSize') target.style.fontSize = value;
            else target.style.lineHeight = value;
            const patch = editStateRef.current.get(targetSelector) ?? {};
            patch[property] = value;
            editStateRef.current.set(targetSelector, patch);
        });
        const rect = element.getBoundingClientRect();
        setSelectionRect({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        refreshResizeChanges();
        scheduleEditHistory();
        const info = describeElement(element);
        setSelected(info);
        post({ type: 'designer:element', element: info });
    }, [captureTarget, getSimilarTargets, post, refreshResizeChanges, scheduleEditHistory, selected?.selector]);

    const exportPng = useCallback(async () => {
        const root = document.getElementById(ROOT_ID);
        if (!root) return;
        post({ type: 'designer:export-status', status: 'started' });
        try {
            const current = configRef.current;
            const dataUrl = await toPng(root, {
                cacheBust: true,
                pixelRatio: 2,
                backgroundColor: '#1a0b2e',
            });
            const link = document.createElement('a');
            link.download = `bamboozle-${current.screen}-${current.view}-${current.viewport.width}x${current.viewport.height}.png`;
            link.href = dataUrl;
            link.click();
            post({ type: 'designer:export-status', status: 'done' });
        } catch (exportError) {
            post({
                type: 'designer:export-status',
                status: 'error',
                message: exportError instanceof Error ? exportError.message : 'PNG export failed',
            });
        }
    }, [post]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent<ParentToPreviewMessage>) => {
            if (event.origin !== window.location.origin || event.source !== window.parent) return;
            const message = event.data;
            if (!message || typeof message !== 'object') return;
            switch (message.type) {
                case 'designer:config': {
                    const next = normaliseConfig(message.config);
                    configRef.current = next;
                    setConfig(next);
                    setError(null);
                    break;
                }
                case 'designer:scan':
                    scan();
                    break;
                case 'designer:export-png':
                    void exportPng();
                    break;
                case 'designer:reset-element-size':
                    resetSelectedSize();
                    break;
                case 'designer:reset-all-element-sizes':
                    resetAllSizes();
                    break;
                case 'designer:set-selected-style':
                    setSelectedStyle(message.property, message.value);
                    break;
                case 'designer:history-action':
                    if (message.action === 'undo') undoEdit();
                    else redoEdit();
                    break;
                case 'designer:reveal-element':
                    revealElement(message.selector);
                    break;
                default:
                    break;
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [exportPng, post, redoEdit, resetAllSizes, resetSelectedSize, scan, setSelectedStyle, undoEdit]);

    useEffect(() => {
        post({ type: 'designer:ready' });
        postEditHistory();
    }, [post, postEditHistory]);

    useEffect(() => {
        sfx.setMuted(config.preview.muted);
    }, [config.preview.muted]);

    useEffect(() => {
        // Let the lab show full motion even when the OS prefers reduced motion.
        if (config.preview.reduceMotion) {
            document.documentElement.removeAttribute('data-designer-force-motion');
        } else {
            document.documentElement.setAttribute('data-designer-force-motion', 'true');
        }
        return () => document.documentElement.removeAttribute('data-designer-force-motion');
    }, [config.preview.reduceMotion]);

    useEffect(() => {
        const timeout = window.setTimeout(scan, 160);
        return () => window.clearTimeout(timeout);
    }, [config, scan]);

    useEffect(() => {
        setSelected(null);
        setSelectionRect(null);
        originalStylesRef.current.clear();
        resizeBaselinesRef.current.clear();
        resizeChangesRef.current.clear();
        editStateRef.current.clear();
        editHistoryRef.current = [new Map()];
        editHistoryIndexRef.current = 0;
        if (editHistoryTimerRef.current) {
            window.clearTimeout(editHistoryTimerRef.current);
            editHistoryTimerRef.current = null;
        }
        post({ type: 'designer:element', element: null });
        post({ type: 'designer:resize-changes', changes: [] });
        postEditHistory();
    }, [config.screen, config.preview.replayKey, post, postEditHistory]);

    useEffect(() => {
        if (!config.preview.resizeSelection || !selected?.selector) {
            setSelectionRect(null);
            return;
        }
        const selector = selected.selector;
        let frame = 0;
        let last = '';
        const update = () => {
            const element = document.querySelector<HTMLElement>(selector);
            if (!element) {
                setSelectionRect(null);
                frame = window.requestAnimationFrame(update);
                return;
            }
            const rect = element.getBoundingClientRect();
            const key = `${rect.x}:${rect.y}:${rect.width}:${rect.height}`;
            if (key !== last) {
                last = key;
                setSelectionRect({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
            }
            frame = window.requestAnimationFrame(update);
        };
        update();
        return () => window.cancelAnimationFrame(frame);
    }, [config.preview.resizeSelection, selected?.selector]);

    useEffect(() => {
        if (!editStateRef.current.size) return;
        const frame = window.requestAnimationFrame(() => {
            applyEditState(editStateRef.current);
            refreshResizeChanges();
        });
        return () => window.cancelAnimationFrame(frame);
    }, [applyEditState, config, refreshResizeChanges]);

    useEffect(() => {
        if (!config.preview.inspect) {
            setHoverRect(null);
            const root = document.getElementById(ROOT_ID);
            if (root) root.style.cursor = '';
            return;
        }
        const root = document.getElementById(ROOT_ID);
        if (!root) return;
        root.style.cursor = 'crosshair';

        const resolveTarget = (event: MouseEvent): HTMLElement | null => {
            const raw = event.target;
            if (!(raw instanceof Element)) return null;
            if (raw.closest('[data-designer-overlay]')) return null;
            const avatar = raw.closest<HTMLElement>('[data-design-avatar]');
            if (avatar && root.contains(avatar)) return avatar;
            let target: HTMLElement | null = raw instanceof HTMLElement ? raw : raw.parentElement;
            while (target && !(target instanceof HTMLElement)) target = target.parentElement;
            if (!target || !root.contains(target) || target === root) return null;
            return target;
        };

        const onPointerMove = (event: MouseEvent) => {
            const target = resolveTarget(event);
            if (!target) {
                setHoverRect(null);
                return;
            }
            const rect = target.getBoundingClientRect();
            setHoverRect({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        };
        const onPointerLeave = () => setHoverRect(null);
        const onClick = (event: MouseEvent) => {
            const target = resolveTarget(event);
            if (!target) return;
            event.preventDefault();
            event.stopPropagation();
            const info = describeElement(target);
            const rect = target.getBoundingClientRect();
            setSelected(info);
            setSelectionRect({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
            setHoverRect(null);
            post({ type: 'designer:element', element: info });
        };

        root.addEventListener('pointermove', onPointerMove);
        root.addEventListener('pointerleave', onPointerLeave);
        document.addEventListener('click', onClick, true);
        return () => {
            root.removeEventListener('pointermove', onPointerMove);
            root.removeEventListener('pointerleave', onPointerLeave);
            document.removeEventListener('click', onClick, true);
            root.style.cursor = '';
        };
    }, [config.preview.inspect, post]);

    const beginElementResize = (event: React.PointerEvent) => {
        const selector = selected?.selector;
        if (!selector) return;
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture?.(event.pointerId);

        const rect = element.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        const startWidth = rect.width;
        const startHeight = rect.height;
        const targets = getSimilarTargets(element).map(captureTarget);
        let moved = false;

        const previousCursor = document.body.style.cursor;
        const previousSelect = document.body.style.userSelect;
        document.body.style.cursor = 'nwse-resize';
        document.body.style.userSelect = 'none';

        const updateBox = (width: number, height: number) => {
            targets.forEach(({ element: target, selector: targetSelector }) => {
                const parentDisplay = target.parentElement
                    ? window.getComputedStyle(target.parentElement).display
                    : '';
                target.style.boxSizing = 'border-box';
                target.style.maxWidth = 'none';
                target.style.maxHeight = 'none';
                target.style.setProperty('width', `${Math.round(width)}px`, 'important');
                target.style.setProperty('height', `${Math.round(height)}px`, 'important');
                if (parentDisplay.includes('flex')) target.style.flex = '0 0 auto';
                const patch = editStateRef.current.get(targetSelector) ?? {};
                patch.width = target.style.getPropertyValue('width');
                patch.height = target.style.getPropertyValue('height');
                patch.boxSizing = 'border-box';
                patch.maxWidth = 'none';
                patch.maxHeight = 'none';
                if (parentDisplay.includes('flex')) patch.flex = '0 0 auto';
                editStateRef.current.set(targetSelector, patch);
            });
            const next = element.getBoundingClientRect();
            setSelectionRect({ x: next.x, y: next.y, width: next.width, height: next.height });
        };

        const move = (moveEvent: PointerEvent) => {
            moved = true;
            const width = Math.max(24, startWidth + moveEvent.clientX - startX);
            const height = Math.max(24, startHeight + moveEvent.clientY - startY);
            updateBox(width, height);
        };
        const stop = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', stop);
            window.removeEventListener('pointercancel', stop);
            document.body.style.cursor = previousCursor;
            document.body.style.userSelect = previousSelect;
            if (moved) {
                refreshResizeChanges();
                commitEditHistory();
            }
            const info = describeElement(element);
            setSelected(info);
            post({ type: 'designer:element', element: info });
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop, { once: true });
        window.addEventListener('pointercancel', stop, { once: true });
    };

    const modelResult = useMemo(() => {
        try {
            return { model: buildPreviewModel(config) as PreviewModel, error: null as string | null };
        } catch (buildError) {
            return { model: null, error: buildError instanceof Error ? buildError.message : 'Could not build preview' };
        }
    }, [config]);

    const renderModel = (model: PreviewModel) => {
        switch (model.kind) {
            case 'game': {
                const key = `${config.screen}-${model.view}-${config.game.joinStep}-${config.game.savedSession}-${config.game.joinName}-${config.game.codeError}-${config.preview.replayKey}`;
                if (model.view === 'online-host' || model.view === 'online-player' || model.view === 'online-audience' || model.view === 'online-unjoined') {
                    return (
                        <div key={key} className="h-full w-full">
                            <OnlinePlayerView
                                state={model.state}
                                actions={actions}
                                playerId={model.playerId}
                                isSpeaking={model.isSpeaking}
                                onHome={noop}
                                hostDisconnected={model.hostDisconnected}
                                roomClosed={model.roomClosed}
                                previewMode
                                showDevChrome={config.app.showDevChrome}
                                initialJoinStep={model.joinStep}
                                previewRejoinCode={model.rejoinCode}
                                previewJoinName={model.joinName}
                                previewCodeError={model.codeError}
                            />
                        </div>
                    );
                }
                if (model.view === 'classic-host') {
                    return (
                        <div key={key} className="h-full w-full">
                            <HostView
                                state={model.state}
                                actions={actions}
                                onHome={noop}
                                debugMode={false}
                                isSpeaking={model.isSpeaking}
                            />
                        </div>
                    );
                }
                return (
                    <div key={key} className="h-full w-full">
                        <PlayerView
                            state={model.state}
                            actions={actions}
                            playerId={model.playerId}
                            hostDisconnected={model.hostDisconnected}
                            roomClosed={model.roomClosed}
                            onHome={noop}
                            previewMode
                            initialJoinStep={model.joinStep}
                            previewRejoinCode={model.rejoinCode}
                            previewJoinName={model.joinName}
                            previewCodeError={model.codeError}
                        />
                    </div>
                );
            }
            case 'home':
                return (
                    <div key={`home-${config.preview.replayKey}`} className="h-full w-full">
                        <HomeView
                            language={config.language}
                            isMobile={model.isMobile}
                            showTestMode={model.showTestMode}
                            onHost={noop}
                            onJoin={noop}
                            onSettings={noop}
                            onToggleLanguage={noop}
                            onTestMode={noop}
                        />
                        {model.roomManagerOpen && (
                            <RoomManagerModal
                                rooms={model.rooms}
                                language={config.language}
                                onCancel={noop}
                                onCreateNew={noop}
                                onRejoin={noop}
                            />
                        )}
                    </div>
                );
            case 'settings':
                return (
                    <div key={`settings-${config.preview.replayKey}`} className="h-full w-full">
                        <SettingsView previewMode preview={model.preview} />
                    </div>
                );
            case 'offline':
                return <div className="h-full w-full"><OfflineView onRetry={noop} /></div>;
            case 'admin':
                return (
                    <div key={`admin-${config.preview.replayKey}`} className="h-full w-full">
                        <AdminView previewMode initialTab={model.tab} previewData={model.data} />
                    </div>
                );
            default:
                return null;
        }
    };

    // Keep the real app subtree stable while inspector/overlay state changes.
    // Without this, every hover/selection-rect update re-renders the game and
    // remounts inner components, which drops live resize edits.
    const previewContent = useMemo(
        () => (modelResult.model ? renderModel(modelResult.model) : null),
        [
            modelResult.model,
            config.app.showDevChrome,
            config.language,
            config.preview.replayKey,
            config.screen,
            config.view,
            config.game.joinStep,
            config.game.savedSession,
            config.game.joinName,
            config.game.codeError,
        ],
    );

    const reducedMotion = config.preview.reduceMotion ? 'always' : 'never';

    return (
        <div
            id={ROOT_ID}
            data-screen={config.screen}
            data-designer-outlines={config.preview.outlines ? 'true' : undefined}
            data-designer-reduced-motion={config.preview.reduceMotion ? 'true' : undefined}
            className="h-full w-full"
        >
            <style>{`
                [data-designer-outlines] *:not([data-designer-overlay]):not(svg):not(path) {
                    outline: 1px solid rgba(56, 189, 248, 0.28) !important;
                    outline-offset: -1px;
                }
                [data-designer-issue] {
                    outline: 2px solid #f87171 !important;
                    outline-offset: -2px;
                    background-color: rgba(248, 113, 113, 0.06) !important;
                }
                [data-designer-flash] {
                    outline: 3px solid #facc15 !important;
                    outline-offset: 2px;
                    transition: outline-color 120ms ease;
                }
                [data-designer-reduced-motion] *,
                [data-designer-reduced-motion] *::before,
                [data-designer-reduced-motion] *::after {
                    animation-duration: 0.001ms !important;
                    animation-delay: 0s !important;
                    transition-duration: 0.001ms !important;
                    transition-delay: 0s !important;
                    scroll-behavior: auto !important;
                }
            `}</style>
            {modelResult.error || error ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-red-950 p-8 text-center text-red-100">
                    <div className="text-sm font-black uppercase tracking-widest">Preview error</div>
                    <pre className="max-w-full overflow-auto whitespace-pre-wrap text-xs text-red-200/80">{modelResult.error || error}</pre>
                </div>
            ) : (
                <PreviewErrorBoundary key={`${config.screen}-${config.preview.replayKey}`} onError={reportError}>
                    <MotionConfig reducedMotion={reducedMotion}>
                        <div data-designer-app="true" className="h-full w-full">
                            {previewContent}
                        </div>
                    </MotionConfig>
                </PreviewErrorBoundary>
            )}

            {config.preview.resizeSelection && selectionRect && selected && (
                <div
                    data-designer-overlay="true"
                    className="pointer-events-none fixed z-[9998] border-2 border-yellow-400 bg-yellow-400/5"
                    style={{
                        left: selectionRect.x,
                        top: selectionRect.y,
                        width: selectionRect.width,
                        height: selectionRect.height,
                    }}
                >
                    <div className="absolute -top-6 left-0 rounded border border-yellow-400/40 bg-black/80 px-1.5 py-0.5 font-mono text-[9px] text-yellow-300">
                        {Math.round(selectionRect.width)}×{Math.round(selectionRect.height)} · drag
                    </div>
                    <button
                        type="button"
                        data-designer-overlay="true"
                        onPointerDown={beginElementResize}
                        onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
                        className="pointer-events-auto absolute -bottom-2.5 -right-2.5 h-5 w-5 cursor-nwse-resize touch-none rounded-md border border-black/30 bg-yellow-400 shadow-lg"
                        title="Resize selected element (preview only)"
                    />
                </div>
            )}

            {hoverRect && (
                <div
                    data-designer-overlay="true"
                    className="pointer-events-none fixed z-[9999] border-2 border-sky-400 bg-sky-400/10"
                    style={{
                        left: hoverRect.x,
                        top: hoverRect.y,
                        width: hoverRect.width,
                        height: hoverRect.height,
                    }}
                />
            )}
        </div>
    );
};
