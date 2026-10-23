import type { Answer, AudienceMember, Emote, Expression, GameState, Player, Question } from '../types';
import { GamePhase } from '../types';
import type { AdminPreviewData } from '../views/AdminView';
import type { ChangelogPreviewData, GitHubRelease } from '../components/ChangelogModal';
import type { DesignerConfig, GamePreviewModel, PreviewModel, RoomSummary } from './types';
import { getCategoryOptions, getCopy, VIEW_BY_VALUE } from './catalog';
import type { CopySet } from './catalog';

const HOST_ID = 'p1';
const PLAYER_ID = 'p2';
const AUDIENCE_ID = 'a1';
const ROOM_CODE = 'BAMZ';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const scoreFor = (spread: DesignerConfig['game']['scoreSpread'], index: number) => {
    if (spread === 'tie') return 1200;
    if (spread === 'wide') return [5000, 3200, 1800, 900, 400, 100][index] ?? 100;
    return [1200, 1100, 1000, 900, 800, 700][index] ?? 700;
};

const expressionFor = (phase: GamePhase, index: number): Expression => {
    if (phase === GamePhase.WRITING) return 'THINKING';
    if (phase === GamePhase.GAME_OVER) return index === 0 ? 'HAPPY' : 'SAD';
    if (phase === GamePhase.LOBBY && index === 0) return 'HAPPY';
    return 'NEUTRAL';
};

const buildPlayers = (config: DesignerConfig, copy: CopySet, phase: GamePhase): Record<string, Player> => {
    const count = clamp(config.game.players, 1, 6);
    const players: Record<string, Player> = {};
    const showNewScores = phase === GamePhase.LEADERBOARD || phase === GamePhase.GAME_OVER;
    const multiplier = phase === GamePhase.LEADERBOARD || phase === GamePhase.GAME_OVER ? 1 : 0;

    for (let index = 0; index < count; index += 1) {
        const id = index === 0 ? HOST_ID : `p${index + 1}`;
        const name = config.overrides.names?.[index] ?? copy.names[index % copy.names.length] ?? `PLAYER ${index + 1}`;
        const ready = config.game.ready === 'all'
            || (config.game.ready === 'some' && index % 2 === 0);
        const score = scoreFor(config.game.scoreSpread, index);
        const lastRoundScore = showNewScores ? [400, 300, 200, 100, 50, 0][index] ?? 0 : 0;
        players[id] = {
            id,
            name,
            avatarSeed: name,
            score,
            isConnected: true,
            isReady: ready,
            isBot: index > 0,
            lastRoundScore: multiplier ? lastRoundScore : 0,
            expression: expressionFor(phase, index),
            previousRank: showNewScores ? (index + 1) % count : undefined,
        };
    }
    return players;
};

const buildAudience = (config: DesignerConfig, copy: CopySet): Record<string, AudienceMember> => {
    const count = clamp(config.game.audience, 0, 12);
    const audience: Record<string, AudienceMember> = {};
    for (let index = 0; index < count; index += 1) {
        const id = `a${index + 1}`;
        const baseName = copy.names[index % copy.names.length] ?? `AUD ${index + 1}`;
        audience[id] = {
            id,
            name: count > copy.names.length ? `${baseName} ${index + 1}` : baseName,
            avatarSeed: `${baseName}-${index}`,
            isBot: true,
        };
    }
    return audience;
};

const buildQuestion = (copy: CopySet): Question => ({
    id: 'q-design',
    fact: copy.fact,
    answer: copy.answer,
    category: copy.category,
    lies: copy.lies,
});

const buildAnswers = (
    config: DesignerConfig,
    players: Record<string, Player>,
    audience: Record<string, AudienceMember>,
    copy: CopySet,
    currentPlayerId: string,
): Answer[] => {
    const count = clamp(config.game.answers, 2, 7);
    const truth: Answer = {
        id: 'a-truth',
        text: copy.answer,
        authorIds: ['SYSTEM'],
        votes: [],
        audienceVotes: [],
    };
    const playerList = Object.values(players);
    const answers: Answer[] = [truth];

    for (let index = 0; index < count - 1; index += 1) {
        const author = playerList[index % playerList.length];
        answers.push({
            id: `a-lie-${index + 1}`,
            text: copy.lies[index] ?? `LIE ${index + 1}`,
            authorIds: author ? [author.id] : ['HOST_BOT'],
            votes: [],
            audienceVotes: [],
        });
    }

    const voterCount = clamp(config.game.voterCount, 0, playerList.length);
    if (voterCount > 0) {
        const voters = playerList.slice(0, voterCount);
        // Keep the current player in the voter set when the "voted" preview is on.
        if (config.game.currentVote && players[currentPlayerId] && !voters.some((player) => player.id === currentPlayerId)) {
            voters[voters.length - 1] = players[currentPlayerId];
        }
        voters.forEach((player, index) => {
            let targetIndex = (index + 1) % answers.length;
            // A player can never vote for their own lie (the truth has no author).
            for (let guard = 0; guard < answers.length; guard += 1) {
                if (!answers[targetIndex].authorIds.includes(player.id)) break;
                targetIndex = (targetIndex + 1) % answers.length;
            }
            const target = answers[targetIndex];
            if (!target.authorIds.includes(player.id)) target.votes.push(player.id);
        });
    }

    const audienceList = Object.values(audience);
    const audienceVoteCount = clamp(config.game.audienceVotes, 0, audienceList.length);
    for (let index = 0; index < audienceVoteCount; index += 1) {
        const target = answers[index % answers.length];
        const member = audienceList[index];
        target.audienceVotes.push(member.id);
        member.currentVote = target.id;
    }

    if (config.game.currentVote) {
        const target = answers.find((answer) => answer.votes.includes(currentPlayerId) || answer.audienceVotes.includes(currentPlayerId))
            ?? answers.find((answer) => !answer.authorIds.includes(currentPlayerId))
            ?? answers.find((answer) => answer.authorIds.includes('SYSTEM'))
            ?? answers[0];
        if (target) {
            if (!target.votes.includes(currentPlayerId)) target.votes.push(currentPlayerId);
            if (players[currentPlayerId]) players[currentPlayerId].currentVote = target.id;
            if (audience[currentPlayerId]) audience[currentPlayerId].currentVote = target.id;
        }
    }

    return answers;
};

const buildEmotes = (config: DesignerConfig, players: Record<string, Player>): Emote[] => {
    const types: Emote['type'][] = ['LAUGH', 'SHOCK', 'LOVE', 'TOMATO'];
    const list = Object.values(players);
    const count = clamp(config.game.emotes, 0, 4);
    return Array.from({ length: count }, (_, index) => {
        const sender = list[index % Math.max(1, list.length)];
        return {
            id: `emote-design-${index + 1}`,
            type: types[index % types.length],
            senderName: sender?.name ?? 'NARRATOR',
            senderSeed: sender?.avatarSeed ?? 'narrator',
            x: [28, 48, 68, 84][index] ?? 50,
            y: [18, 28, 38, 48][index] ?? 20,
            createdAt: 1_700_000_000_000 + index * 1000,
        };
    });
};

const buildSubmittedLies = (config: DesignerConfig, players: Record<string, Player>, copy: CopySet, currentPlayerId: string) => {
    if (config.game.submitted === 'none') return {};
    const list = Object.values(players);
    const submitted = config.game.submitted === 'all'
        ? list
        : list.filter((player, index) => index % 2 === 0 && player.id !== currentPlayerId);
    const result: Record<string, string> = {};
    submitted.forEach((player, index) => {
        const lie = copy.lies[index % copy.lies.length] ?? `LIE ${index + 1}`;
        result[player.id] = lie;
        player.currentLie = lie;
    });
    return result;
};

const buildGamePreview = (config: DesignerConfig): GamePreviewModel => {
    const copy = getCopy(config);
    const view = config.screen === 'join' ? 'online-unjoined' : (config.view === 'online-unjoined' ? 'online-host' : config.view);
    const viewOption = VIEW_BY_VALUE[view] ?? {
        value: 'online-unjoined' as const,
        label: 'Online · Join',
        mode: 'online' as const,
        role: 'unjoined' as const,
    };
    const isJoin = config.screen === 'join';
    const playerId = isJoin
        ? 'spectator'
        : viewOption.role === 'host'
            ? HOST_ID
            : viewOption.role === 'player'
                ? PLAYER_ID
                : AUDIENCE_ID;

    const phase = (() => {
        switch (config.screen) {
            case 'lobby': return GamePhase.LOBBY;
            case 'category': return GamePhase.CATEGORY_SELECT;
            case 'intro': return GamePhase.INTRO;
            case 'writing': return GamePhase.WRITING;
            case 'voting': return GamePhase.VOTING;
            case 'reveal': return GamePhase.REVEAL;
            case 'leaderboard': return GamePhase.LEADERBOARD;
            case 'gameOver': return GamePhase.GAME_OVER;
            case 'join': return config.game.roomPhase === 'lobby' ? GamePhase.LOBBY : GamePhase.WRITING;
            default: return GamePhase.LOBBY;
        }
    })();

    const players = buildPlayers(config, copy, phase);
    const audience = buildAudience(config, copy);
    // A player role needs a second player; an audience role needs at least one viewer.
    if (viewOption.role === 'player' && !players[PLAYER_ID]) {
        players[PLAYER_ID] = {
            ...players[HOST_ID],
            id: PLAYER_ID,
            name: copy.names[1] ?? 'PLAYER 2',
            avatarSeed: copy.names[1] ?? 'PLAYER 2',
        };
    }
    if (viewOption.role === 'audience' && !audience[AUDIENCE_ID]) {
        audience[AUDIENCE_ID] = {
            id: AUDIENCE_ID,
            name: copy.names[0] ?? 'AUD 1',
            avatarSeed: copy.names[0] ?? 'AUD 1',
            isBot: true,
        };
    }

    const answers = buildAnswers(config, players, audience, copy, playerId);
    const categoryOptions = getCategoryOptions(config, copy);
    const otherPlayer = Object.values(players).find((player) => player.id !== playerId) ?? Object.values(players)[0];
    const canSelect = !!players[playerId];
    const selectorId = config.game.categorySelector === 'me' && canSelect
        ? playerId
        : (otherPlayer?.id ?? HOST_ID);
    const submittedLies = buildSubmittedLies(config, players, copy, playerId);
    const revealOrder = answers.map((answer) => answer.id);
    const revealIndex = config.game.revealOutcome === 'mistake' ? Math.min(1, answers.length - 1) : 0;
    if (phase === GamePhase.REVEAL) {
        const target = answers[revealIndex];
        if (target) {
            const eligiblePlayers = Object.values(players).filter((player) => !target.authorIds.includes(player.id));
            const voterCount = config.game.revealOutcome === 'not-found'
                ? 0
                : clamp(config.game.revealVoters, 0, eligiblePlayers.length);
            target.votes = eligiblePlayers.slice(0, voterCount).map((player) => player.id);
            target.audienceVotes = [];
        }
    }
    const isHostView = view === 'online-host' || view === 'classic-host';

    const state: GameState = {
        roomCode: ROOM_CODE,
        phase,
        players,
        audience,
        currentRound: clamp(config.game.round, 1, clamp(config.game.totalRounds, 1, 10)),
        totalRounds: clamp(config.game.totalRounds, 1, 10),
        currentQuestion: buildQuestion(copy),
        submittedLies,
        roundAnswers: answers,
        timeLeft: phase === GamePhase.WRITING || phase === GamePhase.VOTING || phase === GamePhase.CATEGORY_SELECT
            ? clamp(config.game.timeLeft, 0, 120)
            : 0,
        hostId: HOST_ID,
        vipId: HOST_ID,
        usedQuestionIds: [],
        playersWhoPicked: [],
        categorySelection: phase === GamePhase.CATEGORY_SELECT
            ? {
                selectorId,
                options: categoryOptions,
                selected: config.game.categorySelected ? categoryOptions[0] : null,
            }
            : null,
        isNarrating: false,
        emotes: buildEmotes(config, players),
        isOnlineMode: view.startsWith('online'),
        recentCategories: [],
        revealOrder,
        revealStep: phase === GamePhase.REVEAL ? revealIndex : 0,
        revealSubPhase: config.game.revealStage,
        leaderboardPhase: config.game.leaderboardStage,
        language: config.language,
        usePremiumVoices: true,
        isPaused: false,
    };

    return {
        kind: 'game',
        view,
        state,
        playerId,
        isSpeaking: config.game.isSpeaking,
        hostDisconnected: !isHostView && !isJoin && config.game.overlay === 'host-disconnected',
        roomClosed: !isHostView && !isJoin && config.game.overlay === 'room-closed',
        joinStep: config.game.joinStep,
        rejoinCode: config.game.savedSession ? ROOM_CODE : null,
        joinName: config.game.joinName,
        codeError: config.game.codeError,
    };
};

const buildRooms = (config: DesignerConfig, copy: CopySet): RoomSummary[] => {
    const rooms: RoomSummary[] = [{
        roomCode: ROOM_CODE,
        phase: 'LOBBY',
        playerCount: clamp(config.game.players, 1, 6),
        playerNames: copy.names.slice(0, clamp(config.game.players, 1, 6)),
        createdAt: 1_700_000_000_000,
    }];
    if (config.app.roomCount === 2) {
        rooms.push({
            roomCode: 'ZAP2',
            phase: 'WRITING',
            playerCount: Math.min(2, clamp(config.game.players, 1, 6)),
            playerNames: copy.names.slice(1, 3),
            createdAt: 1_700_000_100_000,
        });
    }
    return rooms;
};

export const buildChangelogData = (config: DesignerConfig): ChangelogPreviewData => {
    const copy = getCopy(config);
    if (config.app.changelogState === 'loading') {
        return { loading: true, serverVersion: 'Loading...', releases: [] };
    }
    if (config.app.changelogState === 'error') {
        return {
            loading: false,
            error: 'Failed to load changelog. Please check your connection.',
            serverVersion: 'Unknown',
            releases: [],
        };
    }

    const releases: GitHubRelease[] = [
        {
            id: 1,
            tag_name: 'v0.7.0',
            name: 'v0.7.0 — Design lab',
            body: [
                'Design lab added for every app screen.',
                copy.fact.replace('<BLANK>', copy.answer),
                'Long copy stress: ' + copy.lies[0],
                'Greek copy is checked independently.',
            ].join('\n\n'),
            published_at: '2026-02-19T00:00:00Z',
            html_url: 'https://github.com/gabathanasiou/bamboozle/releases',
        },
        {
            id: 2,
            tag_name: 'v0.6.0',
            name: 'v0.6.0 — Cloudflare rooms',
            body: 'Realtime rooms now run on Cloudflare Workers + Durable Objects in preview.\n\n' + copy.fact.replace('<BLANK>', copy.answer),
            published_at: '2026-01-12T00:00:00Z',
            html_url: 'https://github.com/gabathanasiou/bamboozle/releases',
        },
    ];
    return { loading: false, error: null, serverVersion: '0.7.0', releases };
};

export const buildAdminData = (config: DesignerConfig): AdminPreviewData => {
    const copy = getCopy(config);
    const status = config.app.adminRunning
        ? { isRunning: true, current: 42, total: 90, hits: 18, success: 24, failed: 1 }
        : { isRunning: false, current: 90, total: 90, hits: 30, success: 59, failed: 1 };
    const failures = Array.from({ length: clamp(config.app.adminFailures, 0, 6) }, (_, index) => ({
        text: copy.lies[index % copy.lies.length] ?? `FAILED ITEM ${index + 1}`,
        language: index % 2 === 0 ? 'en' : 'el',
        error: 'TTS generation timed out',
    }));
    const logs = [
        'Started PHRASES (en): 90 items',
        'Cache hit: md5 example',
        'Generated PHRASES (el): 24 items',
        'Waiting for retry queue...',
    ];
    return { status, failures, logs };
};

export const buildPreviewModel = (config: DesignerConfig): PreviewModel => {
    const copy = getCopy(config);
    switch (config.screen) {
        case 'home': {
            return {
                kind: 'home',
                isMobile: config.app.homeMobile,
                showTestMode: config.app.showDevChrome,
                roomManagerOpen: config.app.roomManagerOpen,
                rooms: buildRooms(config, copy),
            };
        }
        case 'settings': {
            return {
                kind: 'settings',
                preview: {
                    useLocalServer: config.app.useLocalServer,
                    usePremiumVoices: config.app.usePremiumVoices,
                    customServerUrl: 'http://localhost:8787',
                    showDevSection: config.app.showDevChrome,
                    changelogOpen: config.app.changelogOpen,
                    changelogData: buildChangelogData(config),
                },
            };
        }
        case 'offline':
            return { kind: 'offline' };
        case 'admin':
            return { kind: 'admin', tab: config.app.adminTab, data: buildAdminData(config) };
        case 'join':
        case 'lobby':
        case 'category':
        case 'intro':
        case 'writing':
        case 'voting':
        case 'reveal':
        case 'leaderboard':
        case 'gameOver':
            return buildGamePreview(config);
        default:
            return buildGamePreview(config);
    }
};

export const createPreviewActions = (overrides: Record<string, unknown> = {}): any => {
    const noop = () => undefined;
    return {
        unlockAudio: noop,
        sendLie: noop,
        sendVote: noop,
        sendAudienceVote: noop,
        sendEmote: noop,
        sendStartGame: noop,
        sendUpdateRounds: noop,
        sendJoin: noop,
        sendJoinAudience: noop,
        sendToggleReady: noop,
        sendCategorySelection: noop,
        sendRestart: noop,
        sendToggleOnlineMode: noop,
        sendTogglePause: noop,
        removePlayer: noop,
        addBot: noop,
        addAudienceBot: noop,
        requestSync: (callback?: (success: boolean) => void) => callback?.(true),
        checkRoomExists: (_code: string, callback?: (exists: boolean) => void) => callback?.(true),
        joinRoom: (_code: string, callback?: (success: boolean, error?: string) => void) => callback?.(true),
        getRoomsByHost: (callback?: (rooms: unknown[]) => void) => callback?.([]),
        ...overrides,
    };
};
