import {
    DEFAULT_CONFIG,
    DesignerConfig,
    DesignerDiagnostics,
    DesignerElementInfo,
    GameView,
    ScreenId,
} from './types';
import { SCREEN_BY_ID, VIEW_BY_VALUE } from './catalog';

export type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

const SCREEN_IDS = new Set<ScreenId>([
    'home', 'settings', 'offline', 'admin', 'join', 'lobby', 'category',
    'intro', 'writing', 'voting', 'reveal', 'leaderboard', 'gameOver',
]);
const VIEWS = new Set<GameView>([
    'online-host', 'online-player', 'online-audience', 'online-unjoined',
    'classic-host', 'classic-player', 'classic-audience',
]);
const LENGTHS = new Set(['short', 'normal', 'long', 'extreme']);
const REVEAL_STAGES = new Set(['INTRO', 'CARD', 'VOTERS', 'AUTHOR']);
const REVEAL_OUTCOMES = new Set(['found', 'not-found', 'mistake']);
const LEADERBOARD_STAGES = new Set(['INTRO', 'REVEAL', 'LEADER']);
const OVERLAYS = new Set(['none', 'host-disconnected', 'room-closed']);
const PRESENCE = new Set(['none', 'some', 'all']);
const SPREADS = new Set(['close', 'wide', 'tie']);
const CHANGELOG_STATES = new Set(['loaded', 'loading', 'error']);
const ADMIN_TABS = new Set(['ACTIONS', 'PROGRESS', 'FAILURES']);
const JOIN_STEPS = new Set(['CODE', 'NAME']);
const ROOM_PHASES = new Set(['lobby', 'in-progress']);
const CATEGORY_SELECTORS = new Set(['me', 'other']);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const valid = <T extends string>(value: unknown, allowed: Set<string>, fallback: T): T =>
    typeof value === 'string' && allowed.has(value) ? value as T : fallback;

export const normaliseConfig = (input?: Partial<DesignerConfig> | null): DesignerConfig => {
    const merged: DesignerConfig = {
        ...DEFAULT_CONFIG,
        ...(input ?? {}),
        viewport: { ...DEFAULT_CONFIG.viewport, ...(input?.viewport ?? {}) },
        overrides: { ...DEFAULT_CONFIG.overrides, ...(input?.overrides ?? {}) },
        game: { ...DEFAULT_CONFIG.game, ...(input?.game ?? {}) },
        app: { ...DEFAULT_CONFIG.app, ...(input?.app ?? {}) },
        preview: { ...DEFAULT_CONFIG.preview, ...(input?.preview ?? {}) },
    };

    const screen = valid<ScreenId>(merged.screen, SCREEN_IDS, DEFAULT_CONFIG.screen);
    let view = valid<GameView>(merged.view, VIEWS, DEFAULT_CONFIG.view);
    if (screen === 'join') view = 'online-unjoined';
    if (screen !== 'join' && view === 'online-unjoined') view = 'online-host';

    const totalRounds = clamp(Math.round(Number(merged.game.totalRounds) || 3), 1, 10);
    const answers = clamp(Math.round(Number(merged.game.answers) || 4), 2, 7);
    const playersCount = clamp(Math.round(Number(merged.game.players) || 4), 1, 6);
    const revealOutcome = valid(merged.game.revealOutcome, REVEAL_OUTCOMES, 'found');
    const revealVoters = revealOutcome === 'not-found'
        ? 0
        : clamp(Math.round(Number(merged.game.revealVoters) || 0), revealOutcome === 'found' ? 1 : 0, playersCount);
    const round = clamp(Math.round(Number(merged.game.round) || 1), 1, totalRounds);

    return {
        ...merged,
        screen,
        view,
        language: merged.language === 'el' ? 'el' : 'en',
        contentLength: valid(merged.contentLength, LENGTHS, DEFAULT_CONFIG.contentLength),
        viewport: {
            preset: String(merged.viewport.preset || 'custom'),
            width: clamp(Math.round(Number(merged.viewport.width) || DEFAULT_CONFIG.viewport.width), 320, 3840),
            height: clamp(Math.round(Number(merged.viewport.height) || DEFAULT_CONFIG.viewport.height), 320, 2160),
        },
        game: {
            ...merged.game,
            players: playersCount,
            audience: clamp(Math.round(Number(merged.game.audience) || 0), 0, 12),
            answers,
            voterCount: clamp(Math.round(Number(merged.game.voterCount) || 0), 0, playersCount),
            audienceVotes: clamp(Math.round(Number(merged.game.audienceVotes) || 0), 0, 12),
            submitted: valid(merged.game.submitted, PRESENCE, 'some'),
            ready: valid(merged.game.ready, PRESENCE, 'some'),
            round,
            totalRounds,
            scoreSpread: valid(merged.game.scoreSpread, SPREADS, 'close'),
            timeLeft: clamp(Math.round(Number(merged.game.timeLeft) || 0), 0, 120),
            emotes: clamp(Math.round(Number(merged.game.emotes) || 0), 0, 4),
            overlay: valid(merged.game.overlay, OVERLAYS, 'none'),
            revealStage: valid(merged.game.revealStage, REVEAL_STAGES, 'CARD'),
            revealOutcome,
            revealVoters,
            leaderboardStage: valid(merged.game.leaderboardStage, LEADERBOARD_STAGES, 'REVEAL'),
            joinStep: valid(merged.game.joinStep, JOIN_STEPS, 'CODE'),
            roomPhase: valid(merged.game.roomPhase, ROOM_PHASES, 'lobby'),
            categorySelector: valid(merged.game.categorySelector, CATEGORY_SELECTORS, 'other'),
        },
        app: {
            ...merged.app,
            roomCount: merged.app.roomCount === 2 ? 2 : 1,
            changelogState: valid(merged.app.changelogState, CHANGELOG_STATES, 'loaded'),
            adminTab: valid(merged.app.adminTab, ADMIN_TABS, 'ACTIONS'),
            adminFailures: clamp(Math.round(Number(merged.app.adminFailures) || 0), 0, 6),
        },
        preview: {
            ...merged.preview,
            replayKey: Math.max(0, Math.round(Number(merged.preview.replayKey) || 0)),
        },
        notes: String(merged.notes ?? ''),
    };
};

export const mergeConfig = (base: DesignerConfig, patch: DeepPartial<DesignerConfig>): DesignerConfig => {
    return normaliseConfig({
        ...base,
        ...patch,
        viewport: { ...base.viewport, ...(patch.viewport ?? {}) },
        overrides: { ...base.overrides, ...(patch.overrides ?? {}) },
        game: { ...base.game, ...(patch.game ?? {}) },
        app: { ...base.app, ...(patch.app ?? {}) },
        preview: { ...base.preview, ...(patch.preview ?? {}) },
    } as DesignerConfig);
};

const bytesToBase64 = (bytes: Uint8Array) => {
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const base64ToBytes = (value: string) => {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

export const encodeConfig = (config: DesignerConfig): string => {
    const bytes = new TextEncoder().encode(JSON.stringify(config));
    return bytesToBase64(bytes);
};

export const decodeConfig = (encoded: string): DesignerConfig | null => {
    try {
        const bytes = base64ToBytes(encoded);
        const json = new TextDecoder().decode(bytes);
        return normaliseConfig(JSON.parse(json));
    } catch {
        return null;
    }
};

export const readConfigFromLocation = (): DesignerConfig => {
    if (typeof window !== 'undefined') {
        const match = window.location.hash.match(/(?:^#|&)cfg=([^&]+)/);
        if (match) {
            const decoded = decodeConfig(match[1]);
            if (decoded) return decoded;
        }
        try {
            const stored = window.localStorage.getItem('bamboozle_designer_config');
            if (stored) {
                const decoded = decodeConfig(stored);
                if (decoded) return decoded;
            }
        } catch {
            // ignore storage errors
        }
    }
    return normaliseConfig();
};

export const writeConfigToLocation = (config: DesignerConfig) => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem('bamboozle_designer_config', encodeConfig(config));
    } catch {
        // ignore storage errors
    }
    const next = `#cfg=${encodeConfig(config)}`;
    if (window.location.hash !== next) {
        try {
            window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${next}`);
        } catch {
            // A very long config can exceed a browser URL limit; storage still holds it.
        }
    }
};

export const buildConfigUrl = (config: DesignerConfig): string => {
    if (typeof window === 'undefined') return `/designer#cfg=${encodeConfig(config)}`;
    return `${window.location.origin}${window.location.pathname}#cfg=${encodeConfig(config)}`;
};

export const getAgentBrief = (
    config: DesignerConfig,
    diagnostics?: DesignerDiagnostics | null,
    element?: DesignerElementInfo | null,
): string => {
    const screen = SCREEN_BY_ID[config.screen];
    const view = VIEW_BY_VALUE[config.view];
    const lines = [
        '# Bamboozle design lab',
        '',
        `- Screen: ${screen.label} (${screen.group})`,
        `- View: ${config.screen === 'join' ? 'Online · Join' : view.label}`,
        `- Viewport: ${config.viewport.width}×${config.viewport.height} (${config.viewport.preset})`,
        `- Language: ${config.language.toUpperCase()} · Content: ${config.contentLength}`,
        `- Players: ${config.game.players} · Audience: ${config.game.audience} · Answers: ${config.game.answers}`,
        `- Voters: ${config.game.voterCount} players + ${config.game.audienceVotes} audience · Submitted: ${config.game.submitted} · Ready: ${config.game.ready} · Current vote: ${config.game.currentVote ? 'yes' : 'no'}`,
        `- Round: ${config.game.round}/${config.game.totalRounds} · Scores: ${config.game.scoreSpread} · Timer: ${config.game.timeLeft}s`,
        `- Reveal: ${config.game.revealStage} · ${config.game.revealOutcome} · ${config.game.revealVoters} people · Leaderboard: ${config.game.leaderboardStage}`,
        `- Overlay: ${config.game.overlay} · Speaking: ${config.game.isSpeaking ? 'yes' : 'no'} · Emotes: ${config.game.emotes}`,
        `- Inspect: ${config.preview.inspect ? 'on' : 'off'} · Outlines: ${config.preview.outlines ? 'on' : 'off'} · Reduced motion: ${config.preview.reduceMotion ? 'on' : 'off'}`,
    ];
    if (config.notes.trim()) {
        lines.push('', '## Notes', config.notes.trim());
    }
    lines.push('', '## Diagnostics', diagnostics?.issues.length
        ? diagnostics.issues.map((issue) => `- [${issue.severity}] ${issue.kind}: ${issue.label} — ${issue.selector} (${issue.detail})`).join('\n')
        : '- No layout issues detected.');
    if (element) {
        lines.push(
            '',
            '## Selected element',
            `- Selector: \`${element.selector}\``,
            `- Tag: ${element.tag} · Size: ${Math.round(element.rect.width)}×${Math.round(element.rect.height)} · Font: ${element.fontSize}/${element.lineHeight}`,
            `- Overflow: ${element.overflowX}/${element.overflowY} · Scroll: ${element.scrollWidth}×${element.scrollHeight}`,
            `- Text: ${element.text || '(none)'}`,
        );
    }
    lines.push('', `Reproduce: ${buildConfigUrl(config)}`);
    return lines.join('\n');
};

export type ParentToPreviewMessage =
    | { type: 'designer:config'; config: DesignerConfig }
    | { type: 'designer:scan' }
    | { type: 'designer:export-png' }
    | { type: 'designer:reveal-element'; selector: string };

export type PreviewToParentMessage =
    | { type: 'designer:ready' }
    | { type: 'designer:diagnostics'; diagnostics: DesignerDiagnostics }
    | { type: 'designer:element'; element: DesignerElementInfo | null }
    | { type: 'designer:error'; message: string }
    | { type: 'designer:export-status'; status: 'started' | 'done' | 'error'; message?: string };

export interface DesignerBridge {
    getConfig(): DesignerConfig;
    apply(patch: DeepPartial<DesignerConfig>): DesignerConfig;
    setScene(screen: ScreenId, patch?: DeepPartial<DesignerConfig>): DesignerConfig;
    setViewport(width: number, height: number, preset?: string): DesignerConfig;
    setContent(patch: DeepPartial<DesignerConfig['overrides']>): DesignerConfig;
    scan(): void;
    getDiagnostics(): DesignerDiagnostics | null;
    getElement(): DesignerElementInfo | null;
    getAgentBrief(): string;
    reset(): DesignerConfig;
}

declare global {
    interface Window {
        __bamboozleDesigner?: DesignerBridge;
    }
}
