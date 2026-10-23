import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Bug, Camera, ChevronLeft, Clipboard, Menu, Play, ScanLine, WandSparkles,
} from 'lucide-react';
import { ControlPanel } from './ControlPanel';
import { PreviewFrame } from './PreviewFrame';
import type {
    ContentOverrides,
    DesignerConfig,
    DesignerDiagnostics,
    DesignerElementInfo,
    GameView,
    ScreenId,
    TextLength,
} from './types';
import { DEFAULT_CONFIG } from './types';
import { SCREEN_BY_ID, VIEW_BY_VALUE } from './catalog';
import {
    buildConfigUrl,
    DeepPartial,
    DesignerBridge,
    getAgentBrief,
    mergeConfig,
    normaliseConfig,
    readConfigFromLocation,
    writeConfigToLocation,
} from './bridge';

const clearCopyOverrides = (overrides: ContentOverrides): ContentOverrides => {
    const next = { ...overrides };
    delete next.fact;
    delete next.category;
    delete next.answer;
    delete next.lies;
    delete next.names;
    return next;
};

const normalizedViewForScreen = (screen: ScreenId, current: GameView): GameView => {
    if (screen === 'join') return 'online-unjoined';
    if (screen !== 'join' && current === 'online-unjoined') return 'online-host';
    return current;
};

export const DesignerView: React.FC = () => {
    const [config, setConfig] = useState<DesignerConfig>(() => readConfigFromLocation());
    const [diagnostics, setDiagnostics] = useState<DesignerDiagnostics | null>(null);
    const [selectedElement, setSelectedElement] = useState<DesignerElementInfo | null>(null);
    const [status, setStatus] = useState<string | null>('Ready — preview is the real app component tree');
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [scanNonce, setScanNonce] = useState(0);
    const [exportNonce, setExportNonce] = useState(0);
    const [revealRequest, setRevealRequest] = useState<{ selector: string; nonce: number } | null>(null);
    const configRef = useRef(config);
    const diagnosticsRef = useRef(diagnostics);
    const selectedRef = useRef(selectedElement);
    const statusTimer = useRef<number | null>(null);

    useEffect(() => {
        configRef.current = config;
        writeConfigToLocation(config);
    }, [config]);

    useEffect(() => {
        diagnosticsRef.current = diagnostics;
    }, [diagnostics]);

    useEffect(() => {
        selectedRef.current = selectedElement;
    }, [selectedElement]);

    useEffect(() => {
        return () => {
            if (statusTimer.current) window.clearTimeout(statusTimer.current);
        };
    }, []);

    const flashStatus = useCallback((message: string) => {
        setStatus(message);
        if (statusTimer.current) window.clearTimeout(statusTimer.current);
        statusTimer.current = window.setTimeout(() => setStatus('Ready'), 3200);
    }, []);

    const update = useCallback((patch: DeepPartial<DesignerConfig>) => {
        setConfig((current) => mergeConfig(current, patch));
    }, []);

    const changeScreen = useCallback((screen: ScreenId) => {
        setDiagnostics(null);
        setSelectedElement(null);
        setRevealRequest(null);
        setConfig((current) => mergeConfig(current, {
            screen,
            view: normalizedViewForScreen(screen, current.view),
        }));
        setSidebarOpen(false);
    }, []);

    const changeView = useCallback((view: GameView) => {
        setDiagnostics(null);
        setSelectedElement(null);
        update({ view });
    }, [update]);

    const changeContentLength = useCallback((contentLength: TextLength) => {
        setConfig((current) => normaliseConfig({
            ...current,
            contentLength,
            overrides: clearCopyOverrides(current.overrides),
        }));
    }, []);

    const changeViewport = useCallback((width: number, height: number, preset: string) => {
        setDiagnostics(null);
        update({ viewport: { width, height, preset } });
    }, [update]);

    const rotate = useCallback(() => {
        changeViewport(config.viewport.height, config.viewport.width, 'custom');
    }, [changeViewport, config.viewport.height, config.viewport.width]);

    const scan = useCallback(() => {
        setScanNonce((value) => value + 1);
        flashStatus('Layout scan requested');
    }, [flashStatus]);

    const replay = useCallback(() => {
        update({ preview: { replayKey: config.preview.replayKey + 1 } });
        flashStatus('Animation replayed');
    }, [config.preview.replayKey, flashStatus, update]);

    const exportPng = useCallback(() => {
        setExportNonce((value) => value + 1);
        flashStatus('Rendering PNG…');
    }, [flashStatus]);

    const reset = useCallback(() => {
        const next = normaliseConfig(DEFAULT_CONFIG);
        setConfig(next);
        setDiagnostics(null);
        setSelectedElement(null);
        setRevealRequest(null);
        flashStatus('Reset to default scene');
    }, [flashStatus]);

    const randomize = useCallback(() => {
        const pick = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)];
        const totalRounds = 3 + Math.floor(Math.random() * 4);
        const players = 1 + Math.floor(Math.random() * 6);
        const next = normaliseConfig({
            ...config,
            language: pick(['en', 'el'] as const),
            contentLength: pick(['short', 'normal', 'long', 'extreme'] as const),
            overrides: {},
            game: {
                ...config.game,
                players,
                audience: Math.floor(Math.random() * 9),
                answers: 2 + Math.floor(Math.random() * 6),
                voterCount: Math.floor(Math.random() * (players + 1)),
                audienceVotes: Math.floor(Math.random() * 4),
                submitted: pick(['none', 'some', 'all'] as const),
                ready: pick(['none', 'some', 'all'] as const),
                currentVote: Math.random() > 0.5,
                round: 1 + Math.floor(Math.random() * totalRounds),
                totalRounds,
                scoreSpread: pick(['close', 'wide', 'tie'] as const),
                timeLeft: Math.floor(Math.random() * 60),
                isSpeaking: Math.random() > 0.6,
                emotes: Math.floor(Math.random() * 5),
                overlay: pick(['none', 'none', 'none', 'host-disconnected', 'room-closed'] as const),
                revealStage: pick(['INTRO', 'CARD', 'VOTERS', 'AUTHOR'] as const),
                revealOutcome: pick(['found', 'not-found', 'mistake'] as const),
                revealVoters: Math.floor(Math.random() * players),
                leaderboardStage: pick(['INTRO', 'REVEAL', 'LEADER'] as const),
                categorySelector: pick(['me', 'other'] as const),
                categorySelected: Math.random() > 0.7,
            },
            preview: {
                ...config.preview,
                replayKey: config.preview.replayKey + 1,
            },
        });
        setConfig(next);
        setDiagnostics(null);
        setSelectedElement(null);
        flashStatus('Randomized stress state');
    }, [config, flashStatus]);

    const copyText = useCallback(async (text: string, label = 'Copied') => {
        try {
            await navigator.clipboard.writeText(text);
            flashStatus(`${label} to clipboard`);
        } catch {
            const area = document.createElement('textarea');
            area.value = text;
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            document.execCommand('copy');
            area.remove();
            flashStatus(`${label} to clipboard`);
        }
    }, [flashStatus]);

    const copyBrief = useCallback(() => {
        void copyText(getAgentBrief(config, diagnostics, selectedElement), 'Agent brief copied');
    }, [config, copyText, diagnostics, selectedElement]);

    const copyJson = useCallback(() => {
        void copyText(JSON.stringify(config, null, 2), 'JSON copied');
    }, [config, copyText]);

    const applyJson = useCallback((json: string) => {
        try {
            const parsed = JSON.parse(json);
            if (!parsed || typeof parsed !== 'object') throw new Error('Expected a JSON object');
            const next = normaliseConfig(parsed);
            setConfig(next);
            setDiagnostics(null);
            setSelectedElement(null);
            flashStatus('JSON config applied');
        } catch (jsonError) {
            flashStatus(jsonError instanceof Error ? `Invalid JSON: ${jsonError.message}` : 'Invalid JSON');
        }
    }, [flashStatus]);

    const revealIssue = useCallback((selector: string) => {
        setRevealRequest({ selector, nonce: Date.now() });
    }, []);

    useEffect(() => {
        const bridge: DesignerBridge = {
            getConfig: () => configRef.current,
            apply: (patch) => {
                const next = mergeConfig(configRef.current, patch);
                configRef.current = next;
                setConfig(next);
                return next;
            },
            setScene: (screen, patch) => {
                const next = mergeConfig(configRef.current, {
                    ...(patch ?? {}),
                    screen,
                    view: normalizedViewForScreen(screen, (patch?.view as GameView) ?? configRef.current.view),
                });
                configRef.current = next;
                setConfig(next);
                setDiagnostics(null);
                setSelectedElement(null);
                return next;
            },
            setViewport: (width, height, preset = 'custom') => {
                const next = mergeConfig(configRef.current, { viewport: { width, height, preset } });
                configRef.current = next;
                setConfig(next);
                return next;
            },
            setContent: (patch) => {
                const next = mergeConfig(configRef.current, { overrides: patch });
                configRef.current = next;
                setConfig(next);
                return next;
            },
            scan: () => setScanNonce((value) => value + 1),
            getDiagnostics: () => diagnosticsRef.current,
            getElement: () => selectedRef.current,
            getAgentBrief: () => getAgentBrief(configRef.current, diagnosticsRef.current, selectedRef.current),
            reset: () => {
                const next = normaliseConfig(DEFAULT_CONFIG);
                configRef.current = next;
                setConfig(next);
                return next;
            },
        };
        window.__bamboozleDesigner = bridge;
        return () => {
            delete window.__bamboozleDesigner;
        };
    }, []);

    const screen = SCREEN_BY_ID[config.screen];
    const viewLabel = config.screen === 'join'
        ? 'Online · Join'
        : screen.kind === 'game'
            ? VIEW_BY_VALUE[config.view].label
            : 'App shell';
    const issueCount = diagnostics?.issues.length ?? 0;

    return (
        <div className="flex h-screen w-full flex-col overflow-hidden bg-[#0b0f19] text-slate-200">
            <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#080c14] px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                    <button
                        type="button"
                        onClick={() => setSidebarOpen((open) => !open)}
                        className="rounded-lg border border-white/10 bg-white/5 p-2 text-slate-400 lg:hidden"
                        title="Toggle controls"
                    >
                        {sidebarOpen ? <ChevronLeft size={16} /> : <Menu size={16} />}
                    </button>
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-yellow-400/30 bg-yellow-400 text-black">
                        <WandSparkles size={17} />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                            <span className="text-xs font-black uppercase tracking-[0.2em] text-white">Bamboozle</span>
                            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-yellow-400/80">Design Lab</span>
                            <span className="hidden rounded border border-green-400/20 bg-green-400/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wide text-green-300 sm:inline">
                                1:1 live components
                            </span>
                        </div>
                        <div className="truncate text-[10px] text-slate-500">
                            {screen.label} · {viewLabel} · {config.viewport.width}×{config.viewport.height} · {config.language.toUpperCase()} · {config.contentLength}
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[9px] ${issueCount ? 'border-red-400/20 bg-red-400/10 text-red-300' : 'border-green-400/20 bg-green-400/10 text-green-300'}`}>
                        <Bug size={11} /> {issueCount ? `${issueCount} issue${issueCount === 1 ? '' : 's'}` : 'no issues'}
                    </span>
                    <button type="button" onClick={scan} className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-slate-400 hover:bg-white/10" title="Scan layout">
                        <ScanLine size={12} /> Scan
                    </button>
                    <button type="button" onClick={replay} className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-slate-400 hover:bg-white/10" title="Replay animations">
                        <Play size={12} /> Replay
                    </button>
                    <button type="button" onClick={exportPng} className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-slate-400 hover:bg-white/10" title="Export PNG">
                        <Camera size={12} /> PNG
                    </button>
                    <button type="button" onClick={copyBrief} className="flex items-center gap-1 rounded-md border border-yellow-400/30 bg-yellow-400/10 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-yellow-300 hover:bg-yellow-400/20" title="Copy structured agent brief">
                        <Clipboard size={12} /> Brief
                    </button>
                </div>
            </header>

            <div className="flex min-h-0 flex-1">
                {sidebarOpen && (
                    <button
                        type="button"
                        aria-label="Close controls"
                        onClick={() => setSidebarOpen(false)}
                        className="fixed inset-0 z-30 bg-black/60 lg:hidden"
                    />
                )}
                <aside className={`${sidebarOpen ? 'flex' : 'hidden'} fixed inset-y-0 left-0 z-40 w-[360px] max-w-[92vw] flex-col border-r border-white/10 bg-[#080c14] lg:static lg:z-auto lg:flex`}>
                    <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-2.5">
                        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Controls</span>
                        <button type="button" onClick={() => setSidebarOpen(false)} className="text-slate-500 hover:text-slate-200 lg:hidden">
                            <ChevronLeft size={16} />
                        </button>
                    </div>
                    <ControlPanel
                        config={config}
                        diagnostics={diagnostics}
                        selectedElement={selectedElement}
                        status={status}
                        onChange={update}
                        onScreenChange={changeScreen}
                        onViewChange={changeView}
                        onContentLengthChange={changeContentLength}
                        onViewportChange={changeViewport}
                        onRotate={rotate}
                        onReset={reset}
                        onRandomize={randomize}
                        onCopyBrief={copyBrief}
                        onCopyJson={copyJson}
                        onApplyJson={applyJson}
                        onCopyText={copyText}
                        onScan={scan}
                        onExportPng={exportPng}
                        onReplay={replay}
                        onRevealIssue={revealIssue}
                        onClearOverrides={() => setConfig((current) => normaliseConfig({ ...current, overrides: clearCopyOverrides(current.overrides) }))}
                    />
                </aside>

                <main className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <PreviewFrame
                        config={config}
                        onViewportChange={changeViewport}
                        onDiagnostics={setDiagnostics}
                        onElement={setSelectedElement}
                        onError={(message) => flashStatus(`Preview error: ${message}`)}
                        onExportStatus={(exportStatus, message) => {
                            if (exportStatus === 'started') flashStatus('Rendering PNG…');
                            else if (exportStatus === 'done') flashStatus('PNG exported');
                            else flashStatus(`PNG export failed: ${message ?? 'unknown error'}`);
                        }}
                        scanNonce={scanNonce}
                        exportNonce={exportNonce}
                        revealRequest={revealRequest}
                        onToggleInspect={() => update({ preview: { inspect: !config.preview.inspect } })}
                        onScan={scan}
                    />
                </main>
            </div>

            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-[#080c14] px-4 py-1.5 text-[9px] text-slate-500">
                <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${status.startsWith('Invalid') || status.startsWith('Preview error') || status.startsWith('PNG export failed') ? 'bg-red-400' : 'bg-green-400'}`} />
                    <span className="truncate">{status}</span>
                </div>
                <div className="flex items-center gap-3 font-mono">
                    <span>{config.screen}</span>
                    <span>{config.view}</span>
                    <span className="hidden sm:inline">{buildConfigUrl(config).slice(0, 72)}…</span>
                </div>
            </footer>
        </div>
    );
};
