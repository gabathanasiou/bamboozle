import { describe, expect, it } from 'vitest';
import type { GameState } from '../types';
import { GamePhase } from '../types';
import { DEFAULT_CONFIG } from './types';
import type { DesignerConfig } from './types';
import { SCREENS, VIEW_OPTIONS, getCopy } from './catalog';
import { buildPreviewModel } from './fixtures';
import { breakpointForWidth, buildResizeRequest, encodeConfig, decodeConfig, getAgentBrief, normaliseConfig } from './bridge';

const withConfig = (patch: Partial<DesignerConfig>): DesignerConfig => normaliseConfig({
    ...DEFAULT_CONFIG,
    ...patch,
    game: { ...DEFAULT_CONFIG.game, ...(patch.game ?? {}) },
    app: { ...DEFAULT_CONFIG.app, ...(patch.app ?? {}) },
    preview: { ...DEFAULT_CONFIG.preview, ...(patch.preview ?? {}) },
});

const gameScreens = SCREENS.filter((screen) => screen.kind === 'game').map((screen) => screen.id);
const views = VIEW_OPTIONS.map((view) => view.value);

const assertState = (state: GameState) => {
    expect(Object.keys(state.players).length).toBeGreaterThan(0);
    expect(state.players[state.hostId]).toBeTruthy();
    expect(state.revealOrder.length).toBe(state.roundAnswers.length);
    for (const answerId of state.revealOrder) {
        expect(state.roundAnswers.some((answer) => answer.id === answerId)).toBe(true);
    }
    expect(state.revealStep).toBeGreaterThanOrEqual(0);
    expect(state.revealStep).toBeLessThan(Math.max(1, state.revealOrder.length));
    for (const answer of state.roundAnswers) {
        for (const voter of answer.votes) expect(state.players[voter]).toBeTruthy();
        for (const voter of answer.audienceVotes) expect(state.audience[voter]).toBeTruthy();
    }
    if (state.phase === GamePhase.CATEGORY_SELECT) {
        expect(state.categorySelection).not.toBeNull();
        expect(state.categorySelection?.options.length).toBeGreaterThan(0);
    }
};

describe('designer scene catalogue', () => {
    it('defines every screen and view', () => {
        expect(SCREENS.length).toBeGreaterThan(0);
        expect(new Set(SCREENS.map((screen) => screen.id)).size).toBe(SCREENS.length);
        expect(VIEW_OPTIONS.length).toBe(6);
    });

    it('builds every screen × every view', () => {
        for (const screen of SCREENS) {
            for (const view of views) {
                const config = withConfig({ screen: screen.id, view });
                const model = buildPreviewModel(config);
                if (model.kind === 'game') {
                    assertState(model.state);
                }
            }
        }
    });

    it('builds every reveal stage and outcome', () => {
        const outcomes = ['found', 'not-found', 'mistake'] as const;
        for (const revealStage of ['INTRO', 'CARD', 'VOTERS', 'AUTHOR'] as const) {
            for (const revealOutcome of outcomes) {
                const config = withConfig({
                    screen: 'reveal',
                    game: { ...DEFAULT_CONFIG.game, revealStage, revealOutcome, revealVoters: 2 },
                });
                const model = buildPreviewModel(config);
                expect(model.kind).toBe('game');
                if (model.kind === 'game') {
                    assertState(model.state);
                    const target = model.state.roundAnswers[model.state.revealStep];
                    expect(target).toBeTruthy();
                    if (revealOutcome === 'found') {
                        expect(target.authorIds).toContain('SYSTEM');
                        expect(target.votes).toHaveLength(2);
                    }
                    if (revealOutcome === 'not-found') {
                        expect(target.authorIds).toContain('SYSTEM');
                        expect(target.votes).toHaveLength(0);
                    }
                    if (revealOutcome === 'mistake') {
                        expect(target.authorIds).not.toContain('SYSTEM');
                        expect(target.votes).toHaveLength(2);
                    }
                    expect(target.audienceVotes).toHaveLength(0);
                }
            }
        }
    });

    it('clamps the reveal voter count to the player count', () => {
        const found = buildPreviewModel(withConfig({
            screen: 'reveal',
            game: { ...DEFAULT_CONFIG.game, revealOutcome: 'found', revealVoters: 99 },
        }));
        expect(found.kind).toBe('game');
        if (found.kind === 'game') {
            expect(found.state.roundAnswers[0].votes).toHaveLength(DEFAULT_CONFIG.game.players);
        }
        const mistake = buildPreviewModel(withConfig({
            screen: 'reveal',
            game: { ...DEFAULT_CONFIG.game, revealOutcome: 'mistake', revealVoters: 0 },
        }));
        expect(mistake.kind).toBe('game');
        if (mistake.kind === 'game') {
            expect(mistake.state.roundAnswers[1].votes).toHaveLength(0);
        }
    });

    it('builds every leaderboard stage', () => {
        for (const leaderboardStage of ['INTRO', 'REVEAL', 'LEADER'] as const) {
            const model = buildPreviewModel(withConfig({
                screen: 'leaderboard',
                game: { ...DEFAULT_CONFIG.game, leaderboardStage },
            }));
            expect(model.kind).toBe('game');
        }
    });

    it('builds app shell states', () => {
        const home = buildPreviewModel(withConfig({ screen: 'home', app: { ...DEFAULT_CONFIG.app, roomManagerOpen: true, roomCount: 2 } }));
        expect(home.kind).toBe('home');
        if (home.kind === 'home') {
            expect(home.roomManagerOpen).toBe(true);
            expect(home.rooms).toHaveLength(2);
        }

        for (const changelogState of ['loaded', 'loading', 'error'] as const) {
            const settings = buildPreviewModel(withConfig({
                screen: 'settings',
                app: { ...DEFAULT_CONFIG.app, changelogOpen: true, changelogState },
            }));
            expect(settings.kind).toBe('settings');
            if (settings.kind === 'settings') {
                expect(settings.preview.changelogData?.loading ?? false).toBe(changelogState === 'loading');
                if (changelogState === 'error') expect(settings.preview.changelogData?.error ?? null).not.toBeNull();
                else expect(settings.preview.changelogData?.error ?? null).toBeNull();
            }
        }

        for (const adminTab of ['ACTIONS', 'PROGRESS', 'FAILURES'] as const) {
            const admin = buildPreviewModel(withConfig({ screen: 'admin', app: { ...DEFAULT_CONFIG.app, adminTab } }));
            expect(admin.kind).toBe('admin');
        }
    });

    it('honours player and audience voter counts', () => {
        const noVotes = buildPreviewModel(withConfig({
            screen: 'voting',
            game: { ...DEFAULT_CONFIG.game, voterCount: 0, audienceVotes: 0, currentVote: false },
        }));
        expect(noVotes.kind).toBe('game');
        if (noVotes.kind === 'game') {
            expect(noVotes.state.roundAnswers.flatMap((answer) => answer.votes)).toHaveLength(0);
            expect(noVotes.state.roundAnswers.flatMap((answer) => answer.audienceVotes)).toHaveLength(0);
        }

        const someVotes = buildPreviewModel(withConfig({
            screen: 'voting',
            game: { ...DEFAULT_CONFIG.game, players: 4, audience: 3, voterCount: 2, audienceVotes: 2, currentVote: false },
        }));
        expect(someVotes.kind).toBe('game');
        if (someVotes.kind === 'game') {
            const voters = someVotes.state.roundAnswers.flatMap((answer) => answer.votes);
            const audienceVoters = someVotes.state.roundAnswers.flatMap((answer) => answer.audienceVotes);
            expect(new Set(voters).size).toBe(2);
            expect(new Set(audienceVoters).size).toBe(2);
        }
    });

    it('keeps game screens on their expected phases', () => {
        const expected: Partial<Record<string, GamePhase>> = {
            lobby: GamePhase.LOBBY,
            category: GamePhase.CATEGORY_SELECT,
            intro: GamePhase.INTRO,
            writing: GamePhase.WRITING,
            voting: GamePhase.VOTING,
            reveal: GamePhase.REVEAL,
            leaderboard: GamePhase.LEADERBOARD,
            gameOver: GamePhase.GAME_OVER,
        };
        for (const [screen, phase] of Object.entries(expected)) {
            const model = buildPreviewModel(withConfig({ screen: screen as DesignerConfig['screen'] }));
            expect(model.kind).toBe('game');
            if (model.kind === 'game') expect(model.state.phase).toBe(phase);
        }
    });
});

describe('content stress', () => {
    it('orders fact/name lengths from short to extreme', () => {
        for (const language of ['en', 'el'] as const) {
            const copies = (['short', 'normal', 'long', 'extreme'] as const).map((contentLength) => getCopy(withConfig({ language, contentLength })));
            expect(copies[0].fact.length).toBeLessThan(copies[1].fact.length);
            expect(copies[1].fact.length).toBeLessThan(copies[2].fact.length);
            expect(copies[2].fact.length).toBeLessThan(copies[3].fact.length);
            expect(copies[0].names[0].length).toBeLessThan(copies[3].names[0].length);
        }
    });

    it('keeps lies within the 50-character input limit', () => {
        for (const language of ['en', 'el'] as const) {
            for (const contentLength of ['short', 'normal', 'long', 'extreme'] as const) {
                for (const lie of getCopy(withConfig({ language, contentLength })).lies) {
                    expect(lie.length).toBeLessThanOrEqual(50);
                }
            }
        }
    });
});

describe('config transport', () => {
    it('round-trips unicode, long copy, and notes through the URL codec', () => {
        const config = withConfig({
            language: 'el',
            notes: 'Το κείμενο είναι πολύ μεγάλο και πρέπει να χωράει.',
            overrides: {
                fact: 'ΜΙΑ ΠΟΛΥ ΜΕΓΑΛΗ ΕΡΩΤΗΣΗ ΜΕ <BLANK> ΚΑΙ ΠΟΛΛΑ ΑΛΛΑ ΛΟΓΙΑ.',
                answer: 'ΑΠΑΝΤΗΣΗ',
                lies: { 0: 'ΕΝΑ ΨΕΜΑ' },
                names: { 0: 'ΑΛΕΞΑΝΔΡΑ-Χ' },
            },
        });
        const encoded = encodeConfig(config);
        expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(decodeConfig(encoded)).toEqual(config);
    });

    it('is deterministic', () => {
        const config = withConfig({ screen: 'reveal', game: { ...DEFAULT_CONFIG.game, revealStage: 'VOTERS' } });
        expect(JSON.stringify(buildPreviewModel(config))).toBe(JSON.stringify(buildPreviewModel(config)));
    });

    it('normalises incompatible view/screen pairs', () => {
        const join = normaliseConfig({ ...DEFAULT_CONFIG, screen: 'join', view: 'classic-host' });
        expect(join.view).toBe('online-unjoined');
        const game = normaliseConfig({ ...DEFAULT_CONFIG, screen: 'lobby', view: 'online-unjoined' });
        expect(game.view).toBe('online-host');
    });

    it('clamps counts and reveals', () => {
        const config = normaliseConfig({
            ...DEFAULT_CONFIG,
            viewport: { preset: 'custom', width: 100, height: 9999 },
            game: { ...DEFAULT_CONFIG.game, players: 99, audience: -1, answers: 99, revealOutcome: 'not-found', revealVoters: 99, round: 99, totalRounds: 2 },
        });
        expect(config.viewport.width).toBe(320);
        expect(config.viewport.height).toBe(2160);
        expect(config.game.players).toBe(6);
        expect(config.game.audience).toBe(0);
        expect(config.game.answers).toBe(7);
        expect(config.game.revealOutcome).toBe('not-found');
        expect(config.game.revealVoters).toBe(0);
        expect(config.game.round).toBe(2);
    });
});


describe('resize handoff', () => {
    it('maps viewport widths to Tailwind breakpoints', () => {
        expect(breakpointForWidth(393)).toBe('base');
        expect(breakpointForWidth(640)).toBe('sm');
        expect(breakpointForWidth(820)).toBe('md');
        expect(breakpointForWidth(1024)).toBe('lg');
        expect(breakpointForWidth(1280)).toBe('xl');
        expect(breakpointForWidth(1536)).toBe('2xl');
    });

    it('includes box/font before-after and the active breakpoint', () => {
        const config = withConfig({ screen: 'lobby' });
        const change = {
            selector: '#designer-preview-root > div > span',
            label: 'ROOM: BAMZ',
            classes: 'text-sm font-bold',
            text: 'ROOM: BAMZ',
            similarCount: 4,
            before: { width: 97, height: 20, fontSize: '14px', lineHeight: '20px', textAlign: 'left' },
            after: { width: 161, height: 48, fontSize: '22px', lineHeight: '20px', textAlign: 'center' },
            viewport: { width: 393, height: 852, breakpoint: 'base' as const },
        };
        const request = buildResizeRequest(config, [change]);
        expect(request).toContain('base breakpoint');
        expect(request).toContain('97×20 → 161×48');
        expect(request).toContain('14px/20px → 22px/20px');
        expect(request).toContain('responsive Tailwind');
        expect(request).toContain('similar elements: 4');
        expect(request).toContain('align left → center');
        const brief = getAgentBrief(config, null, null, [change]);
        expect(brief).toContain('## Live resize');
        expect(brief).toContain('97×20 → 161×48');
    });
});
