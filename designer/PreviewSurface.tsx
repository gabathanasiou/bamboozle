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
import { normaliseConfig } from './bridge';
import type {
    DesignerConfig,
    DesignerDiagnostics,
    DesignerElementInfo,
    PreviewModel,
} from './types';
import type { ParentToPreviewMessage, PreviewToParentMessage } from './bridge';

const ROOT_ID = 'designer-preview-root';
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
    const [error, setError] = useState<string | null>(null);
    const configRef = useRef(config);
    const diagnosticsRef = useRef(diagnostics);

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
                case 'designer:config':
                    setConfig(normaliseConfig(message.config));
                    setError(null);
                    break;
                case 'designer:scan':
                    scan();
                    break;
                case 'designer:export-png':
                    void exportPng();
                    break;
                case 'designer:reveal-element':
                    revealElement(message.selector);
                    break;
                default:
                    break;
            }
        };
        window.addEventListener('message', handleMessage);
        post({ type: 'designer:ready' });
        return () => window.removeEventListener('message', handleMessage);
    }, [exportPng, post, scan]);

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
        post({ type: 'designer:element', element: null });
    }, [config.screen, post]);

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
            const target = event.target;
            if (!(target instanceof HTMLElement)) return null;
            if (!root.contains(target) || target === root) return null;
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
            setSelected(info);
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
                        {modelResult.model ? renderModel(modelResult.model) : null}
                    </MotionConfig>
                </PreviewErrorBoundary>
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
