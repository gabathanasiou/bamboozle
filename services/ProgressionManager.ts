import { GameState, GamePhase, GameEvent } from '../types';
import { getNarratorPhrase } from '../i18n/narrator';

export type RevealStepType = 'INTRO' | 'CARD' | 'VOTERS' | 'AUTHOR' | 'END';

export interface RevealStep {
    type: RevealStepType; // The visual state to show
    answerId?: string;    // The specific context
    text?: string;        // Text to speak
    duration?: number;    // Fallback min duration
    autoAdvance?: boolean; // If true, advance after speaking/delay. If false, wait for trigger.
}

type StateUpdater = (fn: (prev: GameState) => GameState) => void;
type Dispatcher = (event: GameEvent) => void;
type Speaker = (text: string, force?: boolean, key?: string) => Promise<void> | void;

export class ProgressionManager {
    private queue: RevealStep[] = [];
    private currentStepIndex: number = -1;
    private timerId: any = null;
    private isWaitingForAudio: boolean = false;
    private isPaused: boolean = false;
    private stepStartTime: number = 0;
    private remainingDuration: number = 0;
    private pendingAdvance: boolean = false;

    // Dependencies
    private setState: StateUpdater;
    private dispatch: Dispatcher;
    private speak: Speaker;
    private getState: () => GameState;
    private broadcast: (state: GameState) => void;

    constructor(
        setState: StateUpdater,
        dispatch: Dispatcher,
        speak: Speaker,
        getState: () => GameState,
        broadcast: (state: GameState) => void
    ) {
        this.setState = setState;
        this.dispatch = dispatch;
        this.speak = speak;
        this.getState = getState;
        this.broadcast = broadcast;
    }

    // --- CLEANUP ---
    public cleanup() {
        this.clearTimer();
        this.queue = [];
    }

    private clearTimer() {
        if (this.timerId) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
    }

    // --- PAUSE / RESUME ---

    public pause() {
        if (this.isPaused) return;
        this.isPaused = true;
        import.meta.env.DEV && console.log('[Progression] Pausing...');

        if (this.timerId) {
            clearTimeout(this.timerId);
            this.timerId = null;

            // Calculate remaining time for the current delay
            const elapsed = Date.now() - this.stepStartTime;
            this.remainingDuration = Math.max(0, this.remainingDuration - elapsed);
        }
    }

    public resume() {
        if (!this.isPaused) return;
        this.isPaused = false;
        import.meta.env.DEV && console.log('[Progression] Resuming...');

        if (this.pendingAdvance) {
            this.pendingAdvance = false;
            this.processNextStep();
            return;
        }

        if (this.remainingDuration > 0) {
            import.meta.env.DEV && console.log(`[Progression] Resuming wait: ${this.remainingDuration}ms`);
            this.startTimer(this.remainingDuration, () => {
                if (this.isWaitingForAudio) {
                    // If this was the safety timer expiring
                    console.warn('[Progression] Audio timed out (post-resume), advancing force.');
                    this.onAudioEnded();
                } else {
                    this.processNextStep();
                }
            });
        } else if (!this.isWaitingForAudio) {
            // No duration left and not waiting for audio -> advance
            this.processNextStep();
        }
    }

    private startTimer(duration: number, callback: () => void) {
        this.clearTimer();
        this.stepStartTime = Date.now();
        this.remainingDuration = duration;
        this.timerId = setTimeout(callback, duration);
    }

    // --- REVEAL PHASE ---

    /**
     * Generates the reveal queue and starts playback.
     */
    public startRevealPhase(nextState: GameState) {
        // 1. Generate Queue
        this.queue = this.generateRevealQueue(nextState);
        this.currentStepIndex = -1;

        // 2. Start Processing
        this.processNextStep();
    }

    // Helper for joining names (duplicated to avoid circular dependency with Views)
    private joinNames(names: string[], language: 'en' | 'el'): string {
        if (names.length === 0) return '';
        if (names.length === 1) return names[0];
        // Simple fallback for 'and' - ideally this comes from i18n
        const and = language === 'el' ? ' και ' : ' and ';
        const last = names[names.length - 1];
        const others = names.slice(0, -1).join(', ');
        return `${others}${and}${last}`;
    }

    private generateRevealQueue(state: GameState): RevealStep[] {
        const queue: RevealStep[] = [];
        const answers = state.roundAnswers;
        const revealOrder = state.revealOrder;

        // Step 0: Generic Intro
        // queue.push({ type: 'INTRO', text: 'Let\'s see what you wrote!', duration: 2000 });

        revealOrder.forEach((answerId) => {
            const ans = answers.find(a => a.id === answerId);
            if (!ans) return;
            const isTruth = ans.authorIds.includes('SYSTEM');

            const voters = ans.votes.map(vid => state.players[vid]).filter(Boolean);
            const voterNames = this.joinNames(voters.map(v => v.name), state.language);

            // 1. Show Card (Question/Answer) - Only for Lies (Truth starts directly with Author/Fact)
            if (!isTruth) {
                queue.push({
                    type: 'CARD',
                    answerId,
                    text: getNarratorPhrase(state.language, 'REVEAL_CARD_INTRO', { text: ans.text }) || `Who wrote... ${ans.text}?`,
                    duration: 2500
                });
            }

            // 2. Prepare Steps and Push to Queue
            if (!isTruth) {
                // --- LIE REVEAL SEQUENCE ---
                // 1. Show Voters (Who fell for it)
                let voterText = '';
                if (voters.length > 0) {
                    if (ans.audienceVotes && ans.audienceVotes.length > 2) {
                        voterText = getNarratorPhrase(state.language, 'PLAYER_FOOLED_BY_AUDIENCE', { names: voterNames }) || `The audience tricked ${voterNames}!`;
                    } else {
                        voterText = getNarratorPhrase(state.language, 'REVEAL_FOOLED_GROUP', { names: voterNames }) || `Oh no, ${voterNames} fell for it!`;
                    }
                }

                if (voterText) {
                    queue.push({
                        type: 'VOTERS',
                        answerId,
                        text: voterText,
                        duration: 3000
                    });
                }

                // 2. Show Author (Who wrote it)
                let authorText = '';
                const authors = ans.authorIds.map(id => state.players[id]).filter(Boolean);
                if (authors.length > 0) {
                    if (authors.length === 1) {
                        authorText = getNarratorPhrase(state.language, 'REVEAL_LIAR', { name: authors[0].name }) || `${authors[0].name} made that up!`;
                    } else {
                        const names = this.joinNames(authors.map(a => a.name), state.language);
                        authorText = getNarratorPhrase(state.language, 'REVEAL_LIAR_JINX', { names: names }) || `Jinx! ${names} wrote the same thing!`;
                    }
                } else if (ans.authorIds.includes('HOST_BOT')) {
                    authorText = getNarratorPhrase(state.language, 'REVEAL_HOST_LIE', { names: voterNames }) || `I made that one up!`;
                }

                if (authorText) {
                    queue.push({
                        type: 'AUTHOR',
                        answerId,
                        text: authorText,
                        duration: Math.max(4000, authorText.split(' ').length * 450 + 1000)
                    });
                }
            } else {
                // --- TRUTH REVEAL SEQUENCE ---
                // 1. Truth Intro (Uses cached Phrase)
                queue.push({
                    type: 'AUTHOR',
                    answerId,
                    text: getNarratorPhrase(state.language, 'REVEAL_TRUTH_INTRO', {}) || `It's the truth!`,
                    duration: 2000
                });

                // 2. The Actual Fact (Uses cached Question Content)
                const fullFact = state.currentQuestion?.fact.replace('<BLANK>', ans.text) || ans.text;
                queue.push({
                    type: 'AUTHOR',
                    answerId,
                    text: fullFact,
                    duration: Math.max(4000, fullFact.split(' ').length * 450 + 1000)
                });

                // 3. Show Voters (Who got it right)
                let truthVoterText = voters.length > 0
                    ? getNarratorPhrase(state.language, 'REVEAL_CORRECT_GROUP', { names: voterNames }) || `Smart move, ${voterNames}!`
                    : getNarratorPhrase(state.language, 'REVEAL_NOBODY', {}) || `Nobody got this right.`;

                queue.push({
                    type: 'VOTERS',
                    answerId,
                    text: truthVoterText,
                    duration: 3000
                });
            }
        });

        queue.push({ type: 'END' });
        return queue;
    }

    private async processNextStep() {
        this.currentStepIndex++;
        const step = this.queue[this.currentStepIndex];

        // End of Queue?
        if (!step || step.type === 'END') {
            // Trigger Leaderboard Phase
            this.handleRevealComplete();
            return;
        }

        import.meta.env.DEV && console.log('[Progression] Processing Step:', step.type, step.answerId);

        // Update State Visuals
        this.setState(prev => {
            const next = {
                ...prev,
                revealStep: prev.revealOrder.indexOf(step.answerId || '') !== -1
                    ? prev.revealOrder.indexOf(step.answerId || '')
                    : prev.revealStep, // Keep last if generic
                revealSubPhase: step.type === 'END' ? 'AUTHOR' : step.type as any
            };
            // Broadcast the new state to all clients
            this.broadcast(next);
            return next;
        });

        // Broadcast happens automatically by the hook on state change? 
        // No, gameService usually calls broadcastState explicitly or via effect. 
        // We'll rely on the hook effect to broadcast state changes if it exists,
        // OR we might need to trigger it. 
        // *Assumption*: The `useGameService` hook has a `useEffect(() => broadcastState(state), [state])` or similar.
        // Checking `gameService.ts`: It does NOT auto-broadcast. It calls `broadcastState(next)` manually.
        // So we need to trigger broadcast.
        // Since we are setting state via `setState`, the component re-renders. 
        // We need `broadcastState` passed in? 
        // Actually `processHostEvent` broadcasts.
        // Let's assume we need to trigger a sync.

        // Tricky: `setState` is async in React. We can't broadcast immediately with the "new" state from lines above.
        // BUT, `useGameService` has `useEffect(() => stateRef.current = state, [state])`.
        // Also: `useEffect(() => { ... broadcastState(next) ... }, [role])`? No.

        // Solution: pass `broadcastState` to this manager and call it.
        // But `setState` doesn't return the new state immediately.
        // We will pass a `broadcast: (s: GameState) => void` callback.

        // Speak & Wait
        if (step.text) {
            this.isWaitingForAudio = true;
            this.speak(step.text, false, `REVEAL_${step.type}_${step.answerId}`);

            // Safety Timeout (in case audio fails entirely)
            // We'll wait a max of e.g. 10 seconds or duration * 2
            const safetyDelay = Math.max(step.duration || 3000, 5000) + 2000;

            this.startTimer(safetyDelay, () => {
                if (this.isWaitingForAudio) {
                    console.warn('[Progression] Audio timed out, advancing force.');
                    this.onAudioEnded();
                }
            });

        } else {
            // No speech, just delay
            this.startTimer(step.duration || 2000, () => {
                this.processNextStep();
            });
        }
    }

    // --- EVENTS ---

    public onAudioEnded() {
        if (!this.isWaitingForAudio) return;

        import.meta.env.DEV && console.log('[Progression] Audio ended, next step.');
        this.isWaitingForAudio = false;
        this.clearTimer();

        if (this.isPaused) {
            import.meta.env.DEV && console.log('[Progression] Audio ended while paused. Will advance on resume.');
            this.pendingAdvance = true;
            return;
        }

        // Small pause after speech before visual switch?
        this.startTimer(500, () => {
            this.processNextStep();
        });
    }

    public handleRevealComplete() {
        // Transition to Leaderboard
        // We need to call a method on gameService or dispatch an action.
        // Since we don't have the full gameService logic here, we'll assume we can trigger a phase change.
        import.meta.env.DEV && console.log('[Progression] Reveal Complete');

        // Trigger the provided "onPhaseComplete" or similar.
        // For now, we'll modify state directly to move phases if allowed?
        // No, complex logic resides in `startLeaderboardPhase`.
        // We should fire a callback.
        if (this.onRevealFinishedCallback) {
            this.onRevealFinishedCallback();
        }
    }

    private onRevealFinishedCallback: (() => void) | null = null;
    public setOnRevealFinished(cb: () => void) {
        this.onRevealFinishedCallback = cb;
    }
}
