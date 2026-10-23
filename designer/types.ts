import type { GameState } from '../types';
import type { AdminPreviewData } from '../views/AdminView';
import type { SettingsPreviewOptions } from '../views/SettingsView';

export type ScreenId =
    | 'home'
    | 'settings'
    | 'offline'
    | 'admin'
    | 'join'
    | 'lobby'
    | 'category'
    | 'intro'
    | 'writing'
    | 'voting'
    | 'reveal'
    | 'leaderboard'
    | 'gameOver';

export type ScreenGroup = 'App' | 'Join' | 'Game';

export type GameView =
    | 'online-host'
    | 'online-player'
    | 'online-audience'
    | 'online-unjoined'
    | 'classic-host'
    | 'classic-player'
    | 'classic-audience';

export type TextLength = 'short' | 'normal' | 'long' | 'extreme';
export type Overlay = 'none' | 'host-disconnected' | 'room-closed';
export type RevealStage = 'INTRO' | 'CARD' | 'VOTERS' | 'AUTHOR';
export type RevealOutcome = 'found' | 'not-found' | 'mistake';
export type LeaderboardStage = 'INTRO' | 'REVEAL' | 'LEADER';
export type JoinStep = 'CODE' | 'NAME';
export type ChangelogState = 'loaded' | 'loading' | 'error';
export type AdminTab = 'ACTIONS' | 'PROGRESS' | 'FAILURES';
export type PresenceMode = 'none' | 'some' | 'all';
export type ScoreSpread = 'close' | 'wide' | 'tie';

export interface ViewportConfig {
    preset: string;
    width: number;
    height: number;
}

export interface ContentOverrides {
    fact?: string;
    category?: string;
    answer?: string;
    lies?: Record<number, string>;
    names?: Record<number, string>;
}

export interface GameConfig {
    players: number;
    audience: number;
    answers: number;
    voterCount: number;
    audienceVotes: number;
    submitted: PresenceMode;
    ready: PresenceMode;
    currentVote: boolean;
    round: number;
    totalRounds: number;
    scoreSpread: ScoreSpread;
    timeLeft: number;
    isSpeaking: boolean;
    emotes: number;
    overlay: Overlay;
    revealStage: RevealStage;
    revealOutcome: RevealOutcome;
    revealVoters: number;
    leaderboardStage: LeaderboardStage;
    joinStep: JoinStep;
    savedSession: boolean;
    roomPhase: 'lobby' | 'in-progress';
    joinName: string;
    codeError: string;
    categorySelector: 'me' | 'other';
    categorySelected: boolean;
}

export interface AppConfig {
    homeMobile: boolean;
    showDevChrome: boolean;
    roomManagerOpen: boolean;
    roomCount: 1 | 2;
    changelogOpen: boolean;
    changelogState: ChangelogState;
    useLocalServer: boolean;
    usePremiumVoices: boolean;
    adminTab: AdminTab;
    adminRunning: boolean;
    adminFailures: number;
}

export interface PreviewControls {
    muted: boolean;
    reduceMotion: boolean;
    outlines: boolean;
    showIssues: boolean;
    inspect: boolean;
    resizeSelection: boolean;
    replayKey: number;
}

export interface DesignerConfig {
    screen: ScreenId;
    view: GameView;
    language: 'en' | 'el';
    viewport: ViewportConfig;
    contentLength: TextLength;
    overrides: ContentOverrides;
    game: GameConfig;
    app: AppConfig;
    preview: PreviewControls;
    notes: string;
}

export interface RoomSummary {
    roomCode: string;
    phase: string;
    playerCount: number;
    playerNames: string[];
    createdAt: number;
}

export interface GamePreviewModel {
    kind: 'game';
    view: GameView;
    state: GameState;
    playerId: string;
    isSpeaking: boolean;
    hostDisconnected: boolean;
    roomClosed: boolean;
    joinStep: JoinStep;
    rejoinCode: string | null;
    joinName: string;
    codeError: string;
}

export interface HomePreviewModel {
    kind: 'home';
    isMobile: boolean;
    showTestMode: boolean;
    roomManagerOpen: boolean;
    rooms: RoomSummary[];
}

export interface SettingsPreviewModel {
    kind: 'settings';
    preview: SettingsPreviewOptions;
}

export interface OfflinePreviewModel {
    kind: 'offline';
}

export interface AdminPreviewModel {
    kind: 'admin';
    tab: AdminTab;
    data: AdminPreviewData;
}

export type PreviewModel =
    | GamePreviewModel
    | HomePreviewModel
    | SettingsPreviewModel
    | OfflinePreviewModel
    | AdminPreviewModel;

export type Breakpoint = 'base' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

export interface ElementSnapshot {
    width: number;
    height: number;
    fontSize: string;
    lineHeight: string;
}

export interface ResizeChange {
    selector: string;
    label: string;
    classes: string;
    text: string;
    before: ElementSnapshot;
    after: ElementSnapshot;
    viewport: {
        width: number;
        height: number;
        breakpoint: Breakpoint;
    };
}

export interface DesignerElementInfo {
    selector: string;
    tag: string;
    id: string;
    classes: string;
    region: string;
    text: string;
    rect: { x: number; y: number; width: number; height: number };
    fontSize: string;
    lineHeight: string;
    color: string;
    backgroundColor: string;
    overflowX: string;
    overflowY: string;
    scrollWidth: number;
    scrollHeight: number;
    clientWidth: number;
    clientHeight: number;
}

export type IssueKind = 'page-overflow' | 'clipped-text' | 'outside-viewport';

export interface LayoutIssue {
    id: string;
    kind: IssueKind;
    severity: 'error' | 'warning';
    label: string;
    selector: string;
    detail: string;
    rect: { x: number; y: number; width: number; height: number };
}

export interface DesignerDiagnostics {
    issues: LayoutIssue[];
    viewport: { width: number; height: number };
    scroll: { width: number; height: number };
    scannedAt: number;
}

export const DEFAULT_CONFIG: DesignerConfig = {
    screen: 'lobby',
    view: 'online-host',
    language: 'en',
    viewport: { preset: 'iphone-14-pro', width: 393, height: 852 },
    contentLength: 'normal',
    overrides: {},
    game: {
        players: 4,
        audience: 2,
        answers: 4,
        voterCount: 3,
        audienceVotes: 1,
        submitted: 'some',
        ready: 'some',
        currentVote: false,
        round: 1,
        totalRounds: 3,
        scoreSpread: 'close',
        timeLeft: 30,
        isSpeaking: false,
        emotes: 0,
        overlay: 'none',
        revealStage: 'CARD',
        revealOutcome: 'found',
        revealVoters: 2,
        leaderboardStage: 'REVEAL',
        joinStep: 'CODE',
        savedSession: false,
        roomPhase: 'lobby',
        joinName: '',
        codeError: '',
        categorySelector: 'other',
        categorySelected: false,
    },
    app: {
        homeMobile: false,
        showDevChrome: false,
        roomManagerOpen: false,
        roomCount: 2,
        changelogOpen: false,
        changelogState: 'loaded',
        useLocalServer: false,
        usePremiumVoices: true,
        adminTab: 'ACTIONS',
        adminRunning: false,
        adminFailures: 2,
    },
    preview: {
        muted: true,
        reduceMotion: true,
        outlines: false,
        showIssues: true,
        inspect: false,
        resizeSelection: false,
        replayKey: 0,
    },
    notes: '',
};
