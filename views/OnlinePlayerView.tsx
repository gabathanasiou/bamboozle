import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GameState, GamePhase, Player, Answer, Expression } from '../types';
import { Avatar } from '../components/Avatar';
import { Narrator } from '../components/Narrator';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Users, CheckCircle, Lock, Play, Crown, ArrowUp, Star, Menu, X, ChevronDown, RotateCcw, Home } from 'lucide-react';

import { sfx } from '../services/audioService';
import { getText } from '../i18n';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { RevealSequence, LeaderboardSequence, CategoryRoulette, PointsPopup, EmotePopupLayer, CountUp, GameBackground, getAdaptiveTextClass, ConnectionOverlay, DevPauseButton } from './GameSharedComponents';

interface OnlinePlayerViewProps {
    state: GameState;
    actions: any;
    playerId: string;
    isSpeaking: boolean;
    onHome: () => void;
    hostDisconnected?: boolean;
    roomClosed?: boolean;
}

const AvatarStrip = React.memo(({ players, onToggleReactions }: {
    players: Player[],
    onToggleReactions: () => void
}) => {
    if (players.length === 0) return null;

    return (
        <div
            onClick={onToggleReactions}
            className="w-full z-40 shrink-0 relative transition-all duration-300 py-1 px-2 flex flex-wrap justify-center items-end gap-3 md:gap-6 lg:gap-8 min-h-[4rem]"
        >
            {players.map(p => {
                return (
                    <div key={p.id} data-player-id={p.id} className="relative flex-shrink-0 flex flex-col items-center z-10 w-10 md:w-14">
                        <Avatar seed={p.avatarSeed} size={80} expression={p.expression} className="!w-8 !h-8 md:!w-12 md:!h-12 filter drop-shadow-lg transition-transform" />
                        <span className="text-white/90 uppercase font-black mt-1 shadow-black/50 drop-shadow-md text-center leading-none justify-center text-[7px] md:text-[9px] break-words line-clamp-2 w-full">{p.name}</span>
                    </div>
                );
            })}
        </div>
    );
});

export const OnlinePlayerView: React.FC<OnlinePlayerViewProps> = ({ state, actions, playerId, isSpeaking, onHome, hostDisconnected = false, roomClosed = false }) => {
    const me = state.players[playerId];
    const amAudience = state.audience[playerId];
    const isVip = state.vipId === playerId;

    // Derived State
    const isJoined = !!me || !!amAudience;
    const audienceCount = Object.keys(state.audience).length;
    const showTimer = (state.phase === GamePhase.WRITING || state.phase === GamePhase.VOTING || state.phase === GamePhase.CATEGORY_SELECT) && state.timeLeft > 0;
    const isFinalRound = state.currentRound === state.totalRounds;

    // Local interaction state
    const [lieText, setLieText] = useState('');
    const [showTruthWarning, setShowTruthWarning] = useState(false);
    const [myEmoteExpression, setMyEmoteExpression] = useState<Expression | null>(null);

    // Scroll state for Voting
    const answersRef = useRef<HTMLDivElement>(null);
    const [canScrollDown, setCanScrollDown] = useState(false);

    useEffect(() => {
        const checkScroll = () => {
            if (answersRef.current) {
                const { scrollHeight, clientHeight, scrollTop } = answersRef.current;
                const remaining = scrollHeight - clientHeight - scrollTop;
                setCanScrollDown(remaining > 10);
            }
        };

        const el = answersRef.current;
        if (el) {
            checkScroll();
            el.addEventListener('scroll', checkScroll);
            window.addEventListener('resize', checkScroll);
        }

        return () => {
            if (el) {
                el.removeEventListener('scroll', checkScroll);
            }
            window.removeEventListener('resize', checkScroll);
        };
    }, [state.roundAnswers, state.phase]);

    // Entry Flow State
    const [joinStep, setJoinStep] = useState<'CODE' | 'NAME'>('CODE');
    const [inputCode, setInputCode] = useState(state.roomCode || '');
    const [joinName, setJoinName] = useState('');
    const [codeError, setCodeError] = useState('');
    const [rejoinCode, setRejoinCode] = useState<string | null>(null);

    // Mobile Reaction Bar State - Only affects "Mobile" (<768px)
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const [showReactions, setShowReactions] = useState(false);
    const reactionTimerRef = useRef<NodeJS.Timeout | null>(null);
    const lastEmoteRef = useRef<number>(0); // Cooldown: prevent multi-fire on one click

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const resetReactionTimer = () => {
        if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
        reactionTimerRef.current = setTimeout(() => {
            setShowReactions(false);
        }, 10000);
    };

    // Reset interactions on phase change
    useEffect(() => {
        setLieText('');
        setShowTruthWarning(false);
    }, [state.currentRound, state.phase]);

    // Check for rejoinable session
    useEffect(() => {
        // console.log('[OnlinePlayerView] Session check effect. isJoined:', isJoined, 'joinStep:', joinStep, 'actions available:', !!actions);
        if (isJoined || joinStep !== 'CODE') return;

        const storedCode = localStorage.getItem('bamboozle_room_code');
        // console.log('[OnlinePlayerView] Stored room code in localStorage:', storedCode);
        if (storedCode && storedCode.length === 4) {
            actions.checkRoomExists(storedCode, (exists: boolean) => {
                // console.log('[OnlinePlayerView] Room check result for', storedCode, ':', exists);
                if (exists) {
                    setRejoinCode(storedCode);
                } else {
                    localStorage.removeItem('bamboozle_room_code');
                }
            });
        }
    }, [isJoined, joinStep, actions]);

    // Auto-Join if room code exists
    useEffect(() => {
        if (state.roomCode && joinStep === 'CODE') {
            setInputCode(state.roomCode);
            setJoinStep('NAME');
        }
    }, [state.roomCode, joinStep]);

    const handleEmote = (type: 'LAUGH' | 'SHOCK' | 'LOVE' | 'TOMATO') => {
        // Cooldown: ignore if fired within 800ms of last emote (double-tap / event bubbling)
        const now = Date.now();
        if (now - lastEmoteRef.current < 800) return;
        lastEmoteRef.current = now;

        const name = me ? me.name : (amAudience ? amAudience.name : 'Unknown');
        const seed = me ? me.avatarSeed : (amAudience ? amAudience.avatarSeed : 'unknown');

        // Measure avatar position so the emote originates from the right spot
        let xPct = 50;
        let yPct = 15;
        const avatarEl = document.querySelector(`[data-player-id="${playerId}"]`);
        if (avatarEl) {
            const rect = avatarEl.getBoundingClientRect();
            xPct = ((rect.left + rect.width / 2) / window.innerWidth) * 100;
            yPct = ((window.innerHeight - (rect.top + rect.height / 2)) / window.innerHeight) * 100;
        }

        actions.sendEmote(type, name, seed, xPct, yPct);
        sfx.play('CLICK');

        if (type === 'SHOCK') setMyEmoteExpression('SHOCKED');
        else if (type === 'TOMATO') setMyEmoteExpression('ANGRY');
        else setMyEmoteExpression('HAPPY');
        setTimeout(() => setMyEmoteExpression(null), 2000);

        if (isMobile) resetReactionTimer();
    };
    const toggleReactions = useCallback(() => {
        if (showReactions) {
            setShowReactions(false);
            if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
        } else {
            setShowReactions(true);
            resetReactionTimer();
        }
    }, [showReactions]);

    const submitLie = () => {
        if (!state.currentQuestion) return;
        const cleanLie = lieText.trim().toLowerCase();
        const cleanAnswer = state.currentQuestion.answer.toLowerCase();

        if (cleanLie === cleanAnswer || (cleanAnswer.includes(cleanLie) && cleanLie.length > 3)) {
            setShowTruthWarning(true);
            sfx.play('FAILURE');
            setTimeout(() => setShowTruthWarning(false), 3000);
            return;
        }
        actions.sendLie(lieText);
    };

    // --- SUB-COMPONENTS ---

    const TopBar = () => (
        <div className="flex items-center justify-between w-full px-6 pt-safe-top pb-2 z-50 shrink-0">
            <span className="text-white/30 font-bold text-sm uppercase tracking-widest">Bamboozle</span>
            <span className="text-white/30 font-bold uppercase text-sm tracking-wider">{getText(state.language, 'LOBBY_ROOM_CODE', { code: state.roomCode })}</span>
        </div>
    );



    // --- JOIN FLOW ---
    if (!isJoined) {
        return (
            <GameBackground className="flex flex-col h-[100svh] w-full overflow-hidden relative">
                <TopBar />
                <div className="flex-1 flex flex-col items-center justify-center p-6 relative min-h-[60vh]">
                    <div className="w-full max-w-sm space-y-6 relative z-10">
                        <h1 className="text-3xl md:text-5xl font-display text-center text-yellow-400 mb-8 drop-shadow-lg">Bamboozle</h1>

                        {joinStep === 'CODE' && (
                            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                                <p className="text-center text-white/70 mb-2 uppercase font-bold tracking-widest text-sm">{getText(state.language, 'JOIN_ENTER_CODE')}</p>
                                <Input
                                    variant="default"
                                    placeholder={getText(state.language, 'JOIN_PLACEHOLDER_CODE')}
                                    className="p-6 text-center text-4xl md:text-5xl font-black uppercase tracking-[0.2em] shadow-xl"
                                    maxLength={4}
                                    value={inputCode}
                                    onChange={(e) => {
                                        const val = e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4);
                                        setInputCode(val);
                                        setCodeError('');
                                    }}
                                    onCompositionEnd={(e) => {
                                        const val = (e.target as HTMLInputElement).value.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4);
                                        setInputCode(val);
                                        setCodeError('');
                                    }}
                                />
                                {codeError && (
                                    <div className="text-red-300 text-center font-bold animate-pulse uppercase text-sm bg-red-900/50 p-2 rounded">
                                        {codeError}
                                    </div>
                                )}

                                {rejoinCode && !inputCode && (
                                    <motion.button
                                        initial={{ opacity: 0, scale: 0.9 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        onClick={() => {
                                            sfx.play('CLICK');
                                            actions.joinRoom(rejoinCode, (success: boolean, error?: string) => {
                                                if (success) {
                                                    setJoinStep('NAME');
                                                } else {
                                                    setRejoinCode(null);
                                                    localStorage.removeItem('bamboozle_room_code');
                                                }
                                            });
                                        }}
                                        className="w-full bg-white/10 hover:bg-white/20 border-2 border-dashed border-yellow-400/50 p-6 rounded-2xl flex items-center justify-between group transition-all"
                                    >
                                        <div className="text-left">
                                            <p className="text-[10px] font-black text-yellow-400 uppercase tracking-widest opacity-80">{getText(state.language, 'JOIN_ACTIVE_GAME')}</p>
                                            <p className="text-2xl font-black text-white tracking-[0.2em]">{rejoinCode}</p>
                                        </div>
                                        <div className="bg-yellow-400 text-black p-3 rounded-xl group-hover:scale-110 transition-transform">
                                            <RotateCcw size={24} />
                                        </div>
                                    </motion.button>
                                )}

                                <Button
                                    onClick={() => {
                                        const codeToUse = inputCode || rejoinCode;
                                        if (!codeToUse) return;

                                        actions.unlockAudio();
                                        actions.joinRoom(codeToUse, (success: boolean, error?: string) => {
                                            if (success) {
                                                sfx.play('CLICK');
                                                setJoinStep('NAME');
                                            } else {
                                                sfx.play('FAILURE');
                                                setCodeError(error || 'Room not found');
                                            }
                                        });
                                    }}
                                    disabled={!inputCode && !rejoinCode}
                                    variant="primary"
                                    size="lg"
                                    fullWidth
                                >
                                    {getText(state.language, 'JOIN_BTN_ENTER')}
                                </Button>
                                <div className="mt-4">
                                    <Button onClick={() => { sfx.play('CLICK'); onHome(); }} variant="ghost" size="sm" fullWidth className="text-white/40 hover:text-white">
                                        {getText(state.language, 'JOIN_BTN_CANCEL')}
                                    </Button>
                                </div>
                            </motion.div>
                        )}

                        {joinStep === 'NAME' && (
                            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                                <div className="text-center mb-6">
                                    <span className="bg-black/20 text-white/60 text-xs font-bold px-3 py-1 rounded-full uppercase">{getText(state.language, 'LOBBY_ROOM_CODE', { code: state.roomCode })}</span>
                                </div>

                                <Input
                                    variant="default"
                                    placeholder={getText(state.language, 'JOIN_ENTER_NAME')}
                                    className="p-4 text-center text-2xl font-black shadow-lg"
                                    value={joinName}
                                    onChange={e => setJoinName(e.target.value.toUpperCase())}
                                    onCompositionEnd={(e) => setJoinName((e.target as HTMLInputElement).value.toUpperCase())}
                                    maxLength={12}
                                />

                                <div className="space-y-4 pt-4">
                                    {state.phase === GamePhase.LOBBY ? (
                                        <>
                                            <Button
                                                disabled={!joinName || Object.keys(state.players).length >= 6}
                                                onClick={() => { sfx.play('CLICK'); actions.sendJoin(joinName, joinName); }}
                                                variant="success"
                                                size="lg"
                                                fullWidth
                                            >
                                                {getText(state.language, 'JOIN_BTN_PLAY')}
                                            </Button>

                                            <div className="text-center text-white/20 font-bold uppercase text-xs">{getText(state.language, 'JOIN_OR')}</div>

                                            <Button
                                                disabled={!joinName}
                                                onClick={() => { sfx.play('CLICK'); actions.sendJoinAudience(joinName, joinName); }}
                                                variant="secondary"
                                                size="md"
                                                fullWidth
                                            >
                                                <Users size={20} className="mr-2" /> {getText(state.language, 'JOIN_BTN_WATCH')}
                                            </Button>
                                        </>
                                    ) : (
                                        <Button
                                            disabled={!joinName}
                                            onClick={() => {
                                                sfx.play('CLICK');
                                                actions.sendJoin(joinName, joinName);
                                            }}
                                            variant="secondary"
                                            size="lg"
                                            fullWidth
                                        >
                                            <Users size={24} className="mr-2" /> {getText(state.language, 'JOIN_GAME_STARTED')}
                                        </Button>
                                    )}
                                </div>

                                <div className="mt-4">
                                    <Button onClick={() => { sfx.play('CLICK'); onHome(); }} variant="ghost" size="sm" fullWidth className="text-white/40 hover:text-white">
                                        {getText(state.language, 'JOIN_BTN_CANCEL')}
                                    </Button>
                                </div>
                            </motion.div>
                        )}
                    </div>
                </div>
            </GameBackground>
        );
    }

    // --- MAIN GAME RENDER ---

    return (
        <GameBackground className="flex flex-col h-[100svh] w-full overflow-hidden relative">
            <DevPauseButton isPaused={state.isPaused} onToggle={actions.sendTogglePause} />
            <EmotePopupLayer emotes={state.emotes} />
            <TopBar />

            {/* GLOBAL NARRATOR - Static Flow */}
            <div
                className={`w-full flex justify-center z-10 shrink-0 transform transition-transform duration-500 relative origin-top py-2
                    ${state.phase === GamePhase.WRITING ? 'scale-75' : 'scale-100'}
                    ${state.phase === GamePhase.LOBBY ? 'hidden' : 'flex'}
                `}
            >
                <Narrator isSpeaking={isSpeaking} size={70} />
            </div>

            {/* MAIN CONTENT AREA - FlexGrow to fill space */}
            <div className={`
                flex-1 relative flex flex-col w-full max-w-6xl mx-auto min-h-0
                ${(state.phase === GamePhase.VOTING || state.phase === GamePhase.REVEAL) ? 'overflow-hidden' : 'overflow-y-auto no-scrollbar pb-[env(safe-area-inset-bottom,20px)]'}
            `}>

                {/* 1. LOBBY */}
                {state.phase === GamePhase.LOBBY && (
                    <div className="flex-1 flex flex-col md:flex-row w-full max-w-6xl mx-auto p-4 md:p-8 gap-1 md:gap-16 lg:gap-24 relative md:items-center">
                        {/* LEFT COLUMN: Dashboard & Grid */}
                        <div className="flex-1 flex flex-col w-full max-w-md md:max-w-xl mx-auto">
                            {/* A. DASHBOARD (Fixed Top) */}
                            <div className="shrink-0 animate-fade-in-up pb-4 pt-2">
                                <div className="w-full flex flex-row items-center gap-2">
                                    <Narrator isSpeaking={isSpeaking} size={70} className="shrink-0" />
                                    <div className="flex-1 bg-indigo-950 border-4 border-yellow-400 shadow-[4px_4px_0px_0px_#FACC15] rounded-xl p-3 flex flex-row items-center justify-between relative overflow-hidden">
                                        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-20" />
                                        <div className="z-10 flex flex-col items-start leading-none">
                                            <span className="text-yellow-400/80 font-black uppercase tracking-widest text-[8px]">{getText(state.language, 'JOIN_ENTER_CODE')}</span>
                                            <span className="text-3xl md:text-4xl font-black text-white tracking-[0.1em] drop-shadow-[2px_2px_0px_rgba(0,0,0,1)] font-mono">
                                                {state.roomCode}
                                            </span>
                                        </div>
                                        <div className="z-10 flex flex-col gap-1 items-end">
                                            <div className="flex items-center gap-1.5 bg-black/40 px-2 py-0.5 rounded border border-white/10">
                                                <span className="text-white font-bold text-xs uppercase">{getText(state.language, 'LOBBY_ROUNDS')}</span>
                                                <span className="text-yellow-400 font-mono font-black text-xs">{state.totalRounds}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5 bg-black/40 px-2 py-0.5 rounded border border-white/10">
                                                <Users size={10} className="text-blue-400" />
                                                <span className="text-white font-mono font-black text-xs">{audienceCount}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* B. CENTERED PLAYER GRID */}
                            <div className="flex-1 flex flex-col items-center justify-center p-2 min-h-0 overflow-y-auto no-scrollbar">
                                <div className="grid grid-cols-3 gap-y-4 md:gap-y-12 gap-x-2 w-full">
                                    {Object.values(state.players).map((p) => (
                                        <div key={p.id} className="flex flex-col items-center relative">
                                            {p.id === state.vipId && (
                                                <div className="absolute -top-5 z-10">
                                                    <Crown size={16} className="text-yellow-400 filter drop-shadow-md" fill="currentColor" />
                                                </div>
                                            )}
                                            <div className="relative">
                                                <Avatar seed={p.avatarSeed} size={80} expression={p.expression} className={`filter drop-shadow-xl transition-all ${p.isReady ? 'opacity-100 scale-110' : 'opacity-80'}`} />

                                                {/* Remove Button - VIP can remove others in LOBBY */}
                                                {isVip && p.id !== playerId && (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); actions.removePlayer(p.id); }}
                                                        className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 hover:bg-red-600 text-white text-xs rounded-full flex items-center justify-center shadow-lg border-2 border-white transition-all active:scale-95 z-50"
                                                        title="Remove player"
                                                    >
                                                        ✕
                                                    </button>
                                                )}
                                            </div>
                                            <div className="font-black text-white uppercase mt-4 text-[11px] tracking-wider truncate max-w-full text-center drop-shadow-md">{p.name}</div>
                                            <div className={`text-[9px] font-black uppercase mt-1 tracking-widest ${p.isReady ? 'text-green-400' : 'text-white/30'}`}>
                                                {p.isReady ? getText(state.language, 'LOBBY_READY') : getText(state.language, 'LOBBY_WAITING')}
                                            </div>
                                        </div>
                                    ))}
                                    {Array.from({ length: Math.max(0, 6 - Object.values(state.players).length) }).map((_, i) => (
                                        <div key={`empty-${i}`} className="flex flex-col items-center opacity-20">
                                            <div className="w-[80px] h-[80px] rounded-full border-2 border-dashed border-white/40 flex items-center justify-center">
                                                <Users size={24} className="text-white/20" />
                                            </div>
                                            <div className="mt-4 w-16 h-2 bg-white/10 rounded-full" />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* RIGHT COLUMN: Lobby Controls */}
                        <div className="w-full md:w-96 flex flex-col justify-center shrink-0 max-w-md mx-auto z-20 md:mt-0">
                            {me && (
                                <div className="w-full flex flex-col gap-3 md:gap-4 mt-6 md:mt-0 pb-safe-bottom md:pb-0">
                                    <button
                                        onClick={actions.sendToggleReady}
                                        className={`w-full py-4 rounded-xl font-black text-lg shadow-xl uppercase transition-all duration-150 active:scale-95 ${me?.isReady ? 'bg-gray-600 hover:bg-gray-500 text-gray-300' : 'bg-green-500 hover:bg-green-400 text-white'}`}
                                    >
                                        {me?.isReady ? getText(state.language, 'LOBBY_IS_READY') : getText(state.language, 'LOBBY_READY_UP')}
                                    </button>
                                    {isVip && (
                                        <div className="flex flex-col gap-4 w-full">
                                            <div className="flex items-center justify-between bg-black/40 p-3 rounded-xl border border-white/10">
                                                <span className="font-bold text-white uppercase text-sm">{getText(state.language, 'LOBBY_ROUNDS')}</span>
                                                <div className="flex items-center gap-4">
                                                    <button
                                                        onClick={() => actions.sendUpdateRounds(Math.max(1, state.totalRounds - 1))}
                                                        className="w-8 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-lg text-white font-bold"
                                                    >
                                                        -
                                                    </button>
                                                    <span className="text-xl font-black text-yellow-400 w-4 text-center">{state.totalRounds}</span>
                                                    <button
                                                        onClick={() => actions.sendUpdateRounds(Math.min(10, state.totalRounds + 1))}
                                                        className="w-8 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-lg text-white font-bold"
                                                    >
                                                        +
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <button
                                                    onClick={actions.addBot}
                                                    className="bg-blue-600/50 hover:bg-blue-600 py-3 rounded-xl text-xs font-bold uppercase"
                                                    disabled={Object.keys(state.players).length >= 6}
                                                >
                                                    {getText(state.language, 'LOBBY_ADD_BOT')}
                                                </button>
                                                <button
                                                    onClick={() => { sfx.play('CLICK'); onHome(); }}
                                                    className="bg-red-600/50 hover:bg-red-600 py-3 rounded-xl text-xs font-bold uppercase flex items-center justify-center gap-2"
                                                >
                                                    <Home size={14} /> Home
                                                </button>
                                            </div>
                                            {import.meta.env.DEV && (
                                                <button
                                                    onClick={actions.addAudienceBot}
                                                    className="w-full bg-indigo-600/30 hover:bg-indigo-600/50 py-2 rounded-xl text-[10px] font-bold uppercase border border-white/10"
                                                >
                                                    + Audience (Dev)
                                                </button>
                                            )}

                                            <button
                                                disabled={!Object.values(state.players).every(p => p.isReady) || Object.values(state.players).length === 0}
                                                onClick={() => {
                                                    actions.unlockAudio();
                                                    actions.sendStartGame(state.totalRounds);
                                                }}
                                                className="w-full bg-yellow-400 text-black py-3 rounded-xl font-black text-lg shadow-xl uppercase disabled:opacity-50 disabled:grayscale"
                                            >
                                                {getText(state.language, 'LOBBY_START_GAME')}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                            {amAudience && <div className="w-full text-center text-white/50 font-bold uppercase pb-safe-bottom md:pb-0 mt-8 md:mt-0">{getText(state.language, 'LOBBY_AUDIENCE_MODE')}</div>}
                        </div>
                    </div>
                )}

                {/* 2. CATEGORY SELECT */}
                {state.phase === GamePhase.CATEGORY_SELECT && (
                    <div className="flex-1 flex flex-col items-center justify-center relative p-4 min-h-0 w-full">
                        {/* Timer moved safely away from content */}
                        <div className="absolute top-2 right-2 bg-black/50 px-3 py-1 rounded-full border border-white/20 backdrop-blur-md z-50">
                            <div className="flex items-center gap-2">
                                <Clock size={16} className="text-yellow-400 animate-pulse" />
                                <span className="font-mono font-bold text-lg text-white">{state.timeLeft}</span>
                            </div>
                        </div>
                        <CategoryRoulette
                            state={state}
                            onSelect={state.categorySelection?.selectorId === playerId ? (cat) => actions.sendCategorySelection(cat) : undefined}
                        />
                    </div>
                )}

                {/* 3. WRITING (And INTRO) */}
                {(state.phase === GamePhase.WRITING || state.phase === GamePhase.INTRO) && (
                    <div className="flex-1 flex flex-col items-center justify-center p-4 min-h-0 w-full">
                        <div className="w-full max-w-md flex flex-col items-center gap-4">

                            {/* Stats Header */}
                            <div className="w-full flex items-center justify-between px-1 pb-1 relative z-20 flex-shrink-0">
                                <div className="flex items-center gap-2">
                                    <div className="bg-purple-600/90 text-white text-[10px] font-black uppercase px-2 py-1 rounded-lg border-2 border-purple-400 shadow-sm">
                                        {isFinalRound ? getText(state.language, 'GAME_FINAL_ROUND') : getText(state.language, 'GAME_ROUND', { current: state.currentRound, total: state.totalRounds })}
                                    </div>
                                    {(state.currentRound === state.totalRounds) && (
                                        <div className="bg-yellow-400 text-black text-[10px] font-black uppercase px-2 py-1 rounded-lg border-2 border-white shadow-sm animate-pulse">
                                            {getText(state.language, 'GAME_TRIPLE_POINTS')}
                                        </div>
                                    )}
                                    {(state.currentRound === state.totalRounds - 1) && (
                                        <div className="bg-yellow-400 text-black text-[10px] font-black uppercase px-2 py-1 rounded-lg border-2 border-white shadow-sm animate-pulse">
                                            {getText(state.language, 'GAME_DOUBLE_POINTS')}
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center gap-1 bg-black/40 px-2 py-1 rounded-lg border border-white/10">
                                    <Users size={12} className="text-white" />
                                    <span className="text-[10px] md:text-xs font-black text-white">{audienceCount}</span>
                                </div>
                            </div>

                            {/* Fact Card */}
                            <div className="w-full bg-white text-purple-900 p-4 md:p-6 rounded-2xl md:rounded-3xl shadow-xl border-b-4 md:border-b-8 border-purple-300 relative z-10 min-h-[13vh] flex items-center justify-center">
                                <p className={`font-black leading-tight uppercase text-center break-words ${getAdaptiveTextClass(state.currentQuestion?.fact.replace('<BLANK>', '________') || '', 'text-base md:text-2xl', 80)}`}>
                                    {state.currentQuestion?.fact.replace('<BLANK>', '________')}
                                </p>
                            </div>

                            <AnimatePresence>
                                {showTruthWarning && (
                                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="bg-red-500 text-white px-4 py-2 rounded-full font-bold uppercase text-xs shadow-lg animate-bounce">
                                        {getText(state.language, 'PROMPT_CANNOT_TRUTH')}
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Input Area */}
                            {state.phase === GamePhase.WRITING && (
                                <div className="w-full mt-2 flex flex-col gap-3">
                                    {me && !state.submittedLies[playerId] ? (
                                        <>
                                            <Input
                                                variant="transparent"
                                                className="p-4 text-base md:text-lg font-bold text-center"
                                                placeholder={getText(state.language, 'PROMPT_LIE_HERE')}
                                                value={lieText}
                                                onChange={e => setLieText(e.target.value.toUpperCase())}
                                                onCompositionEnd={(e) => setLieText((e.target as HTMLInputElement).value.toUpperCase())}
                                                maxLength={50}
                                            />

                                            <div className="flex justify-center py-2">
                                                <div className="flex items-center gap-2 bg-black/20 px-3 py-1 rounded-full border border-white/10">
                                                    <Clock size={16} className="text-yellow-400 animate-pulse" />
                                                    <span className="font-mono font-bold text-xl text-white">{state.timeLeft}s</span>
                                                </div>
                                            </div>

                                            <Button
                                                onClick={submitLie}
                                                disabled={!lieText.trim()}
                                                variant="primary"
                                                size="lg"
                                                fullWidth
                                            >
                                                {getText(state.language, 'PROMPT_SUBMIT')}
                                            </Button>
                                        </>
                                    ) : me && (
                                        <div className="mt-4 bg-green-500/20 text-green-400 px-6 py-8 rounded-xl font-black uppercase flex flex-col items-center gap-2 border border-green-500/50">
                                            <CheckCircle size={40} />
                                            {getText(state.language, 'PROMPT_LIE_SENT')}
                                        </div>
                                    )}
                                    {amAudience && <div className="mt-8 text-white/50 font-bold uppercase text-center">{getText(state.language, 'PROMPT_WAITING')}</div>}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* 4. VOTING */}
                {state.phase === GamePhase.VOTING && (
                    <div className="flex-1 flex flex-col items-center w-full h-full overflow-hidden relative">
                        {/* Fixed Header */}
                        <div className="shrink-0 w-full max-w-md p-3 pb-2 flex flex-col items-center z-10">
                            {/* Timer */}
                            <div className="flex justify-center mb-4 relative z-30">
                                <div className="flex items-center gap-2 bg-black/60 backdrop-blur-md px-4 py-1 rounded-full border border-white/20 shadow-lg">
                                    <Clock size={18} className="text-yellow-400 animate-pulse" />
                                    <span className="font-mono font-bold text-md text-white">{state.timeLeft}s</span>
                                </div>
                            </div>

                            <div className="w-full bg-purple-800/50 p-4 mb-4 justify-center items-center rounded-xl border border-white/10 backdrop-blur-sm shadow-md text-center max-h-[20vh] min-h-[10vh] overflow-y-auto">
                                <p className={`font-bold text-white leading-tight uppercase ${getAdaptiveTextClass(state.currentQuestion?.fact.replace('<BLANK>', '________') || '', 'text-lg', 75)}`}>
                                    {state.currentQuestion?.fact.replace('<BLANK>', '________')}
                                </p>
                            </div>
                        </div>

                        {/* Answers Grid - Scrollable */}
                        <div
                            ref={answersRef}
                            className="flex-1 w-full overflow-y-auto px-2 pb-4 no-scrollbar flex justify-center min-h-0"
                        >
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 w-full pb-8 h-max">
                                {state.roundAnswers.filter(a => !a.authorIds.includes(playerId)).map((ans, idx) => {
                                    const iVoted = amAudience ? ans.audienceVotes.includes(playerId) : me?.currentVote === ans.id;
                                    return (
                                        <motion.button
                                            key={ans.id}
                                            initial={{ scale: 0.9, opacity: 0 }}
                                            animate={{ scale: 1, opacity: 1 }}
                                            transition={{ delay: idx * 0.05 }}
                                            onClick={() => {
                                                if (!iVoted) {
                                                    sfx.play('CLICK');
                                                    if (amAudience) actions.sendAudienceVote(ans.id);
                                                    else actions.sendVote(ans.id);
                                                }
                                            }}
                                            disabled={iVoted && !amAudience}
                                            className={`
                                                  w-full p-4 rounded-xl border-b-4 md:border-b-8 font-black shadow-lg transition-all active:scale-95 uppercase relative overflow-hidden min-h-[50px] flex items-center justify-center
                                                  ${iVoted
                                                    ? 'bg-blue-600 border-blue-800 text-white'
                                                    : 'bg-white border-blue-200 text-indigo-950 hover:bg-blue-50'
                                                }
                                                  ${(me?.currentVote && !iVoted) ? 'opacity-50 grayscale' : ''}
                                              `}
                                        >
                                            <div className="relative z-10 flex flex-col w-full justify-center items-center h-full px-2">
                                                <span className={`leading-tight text-center w-full break-words whitespace-normal drop-shadow-sm ${getAdaptiveTextClass(ans.text, 'text-md :text-lg', 30)}`}>{ans.text}</span>
                                            </div>

                                            {/* Audience Indicator - Absolute Top Right */}
                                            {ans.audienceVotes.length > 0 && (
                                                <div className={`absolute top-2 right-2 flex items-center gap-1 font-black text-xs px-2 py-0.5 rounded-full ${iVoted ? 'bg-blue-800 text-blue-200' : 'bg-blue-100 text-blue-600'}`}>
                                                    <Users size={12} />
                                                    <span>{ans.audienceVotes.length}</span>
                                                </div>
                                            )}
                                        </motion.button>
                                    )
                                })}
                            </div>
                        </div>

                        {/* Scroll Indicator */}
                        <AnimatePresence>
                            {canScrollDown && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: 10 }}
                                    className="absolute bottom-4 left-0 right-0 flex justify-center pointer-events-none z-20"
                                >
                                    <div className="bg-black/80 backdrop-blur-md text-white/90 pl-4 pr-3 py-2 rounded-full text-xs font-bold uppercase flex items-center gap-2 border border-white/20 shadow-xl animate-bounce">
                                        {getText(state.language, 'VOTE_SCROLL')} <ChevronDown size={14} className="animate-pulse" />
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                )}

                {/* 5. REVEAL & LEADERBOARD (Shared) */}
                {state.phase === GamePhase.REVEAL && (
                    <div className="flex-1 flex flex-col items-center p-2 md:p-3 px-6 md:px-8 min-h-0 w-full overflow-hidden">
                        <RevealSequence state={state} actions={actions} setGalleryOverrides={() => { }} isHost={isVip} />
                    </div>
                )}

                {state.phase === GamePhase.LEADERBOARD && (
                    <div className="flex-1 flex items-center justify-center p-4">
                        <LeaderboardSequence state={state} actions={actions} onHome={() => { }} isHost={isVip} />
                    </div>
                )}

                {state.phase === GamePhase.GAME_OVER && (
                    <div className="flex-1 flex flex-col items-center justify-start p-4 py-8 overflow-y-auto">
                        <LeaderboardSequence state={state} actions={actions} onHome={() => { }} isHost={isVip} />

                        {!isVip && (
                            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3 }} className="mt-8 flex gap-4 uppercase pb-12">
                                <div className="text-xl md:text-2xl text-yellow-400 font-bold animate-pulse text-center">
                                    {getText(state.language, 'GAME_WAITING_VIP')}
                                </div>
                            </motion.div>
                        )}

                        {isVip && (
                            <div className="flex flex-col gap-4 mt-8 w-full max-w-sm pb-12 shrink-0">
                                <button onClick={() => actions.sendRestart()} className="bg-green-500 hover:bg-green-600 text-white px-8 py-4 rounded-xl font-black text-xl shadow-lg uppercase w-full">
                                    {getText(state.language, 'GAME_OVER_PLAY_AGAIN')}
                                </button>
                                <button onClick={() => window.location.reload()} className="bg-red-500 hover:bg-red-600 text-white px-8 py-4 rounded-xl font-black text-xl shadow-lg uppercase w-full">
                                    {getText(state.language, 'GAME_OVER_END_GAME')}
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* PERSISTENT BOTTOM BAR (Avatar Strip + Emotes) - With Safe Area support */}
            {
                state.phase !== GamePhase.LOBBY && state.phase !== GamePhase.LEADERBOARD && state.phase !== GamePhase.GAME_OVER && (
                    <div className="z-50 flex flex-col justify-center bg-transparent shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}>
                        <AvatarStrip
                            players={Object.values(state.players)}
                            onToggleReactions={toggleReactions}
                        />
                        {/* Reaction panel - grid-template-rows trick: collapses to 0 and pushes avatars up, GPU-smooth */}
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateRows: showReactions ? '1fr' : '0fr',
                                transition: 'grid-template-rows 200ms ease',
                            }}
                        >
                            <div
                                style={{
                                    overflow: 'hidden',
                                    opacity: showReactions ? 1 : 0,
                                    transform: showReactions ? 'translateY(0)' : 'translateY(8px)',
                                    transition: 'opacity 160ms ease, transform 160ms ease',
                                    willChange: 'transform, opacity',
                                }}
                            >
                                <div className="grid grid-cols-4 gap-2 px-4 py-3 w-full max-w-sm mx-auto">
                                    {(['😂', '😮', '❤️', '🍅'] as const).map((emoji, i) => {
                                        const types = ['LAUGH', 'SHOCK', 'LOVE', 'TOMATO'] as const;
                                        return (
                                            <button
                                                key={emoji}
                                                onClick={() => handleEmote(types[i])}
                                                className="bg-white/10 p-3 rounded-xl text-3xl border border-white/5 aspect-square flex items-center justify-center active:scale-90"
                                                style={{ transition: 'transform 100ms ease, background-color 120ms ease' }}
                                                onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.2)')}
                                                onMouseLeave={e => (e.currentTarget.style.backgroundColor = '')}
                                            >
                                                {emoji}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Connection Status Overlay */}
            <ConnectionOverlay
                hostDisconnected={hostDisconnected}
                roomClosed={roomClosed}
                language={state.language}
                roomCode={state.roomCode}
                onHomeClick={onHome}
            />
        </GameBackground >
    );
};
