import React, { useEffect, useState, useRef, Fragment } from 'react';
import { GameState, GamePhase, Player, Expression, Emote } from '../types';
import { Avatar } from '../components/Avatar';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, Play, Pause } from 'lucide-react';
import { sfx } from '../services/audioService';
import { NARRATOR_SEED } from '../constants';
import { getText } from '../i18n';

// --- Helper Functions ---

/**
 * Joins a list of names into a natural language string.
 * @param names Array of names to join.
 * @returns A string like "Alice, Bob and Charlie".
 */
export const joinNames = (names: string[]) => {
    if (names.length === 0) return '';
    if (names.length === 1) return names[0];
    if (names.length === 2) return names.join(' and ');
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
};

/**
 * Calculates the point values for the current round.
 * @param currentRound The current round number (1-based).
 * @param totalRounds The total number of rounds in the game.
 * @returns Object containing points for 'truth' (fooling others) and 'lie' (tricking others).
 */
export const getPointsConfig = (currentRound: number, totalRounds: number) => {
    let multiplier = 1;
    if (currentRound === totalRounds) multiplier = 3;
    else if (currentRound === totalRounds - 1) multiplier = 2;

    return {
        truth: 1000 * multiplier,
        lie: 500 * multiplier
    };
};

/**
 * Returns a CSS class for text sizing based on length.
 * @param text The text to measure.
 * @param baseSize The default text size class (e.g., 'text-2xl').
 * @param lengthLimit The character limit before shrinking occurs.
 * @returns The tailwind class string.
 */
export const getAdaptiveTextClass = (text: string, baseSize: string, lengthLimit: number = 50) => {
    if (!text) return baseSize;
    return 'break-words';
    // Note: Future implementation could dynamically scale font size here
};

// --- Functional Components ---

/**
 * The standard animated background for the game views.
 */
export const GameBackground = ({ children, className = '' }: { children: React.ReactNode, className?: string }) => (
    <div className={`relative w-full h-full bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 overflow-hidden text-white selection:bg-pink-500 font-display flex flex-col ${className}`}>
        <div className="absolute inset-0 z-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
        {children}
    </div>
);

/**
 * An animated counter that counts up from a start value to an end value.
 */
export const CountUp = ({ value, from }: { value: number; from: number }) => {
    const [displayValue, setDisplayValue] = useState(isNaN(from) ? 0 : from);

    useEffect(() => {
        let start = from;
        const end = value;
        if (start === end) return;
        const duration = 1500;
        const startTime = performance.now();
        let lastSoundTime = 0;

        const animate = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const ease = 1 - Math.pow(1 - progress, 4);
            const current = Math.floor(start + (end - start) * ease);
            setDisplayValue(current);

            // Play ticking sound while counting
            if (currentTime - lastSoundTime > 100) {
                sfx.play('TICK');
                lastSoundTime = currentTime;
            }

            if (progress < 1) requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    }, [value, from]);

    return <span>{displayValue}</span>;
};

/**
 * A popup animation showing points earned (+1000 PTS).
 */
export const PointsPopup = ({ amount, label = 'PTS', placement = 'bottom' }: { amount: number, label?: string, placement?: 'top' | 'bottom' }) => {
    useEffect(() => {
        sfx.play('SUCCESS');
    }, []);

    const positionClass = placement === 'top'
        ? "absolute bottom-full left-0 mb-4 pb-2"
        : "absolute top-full left-0 mt-2";

    return (
        <motion.div
            initial={{ scale: 0, y: placement === 'top' ? 10 : -10, opacity: 0 }}
            animate={{ scale: 0.9, y: 0, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 10 }}
            className={`${positionClass} z-[100] flex flex-col items-center pointer-events-none w-full`}
        >
            <div className="text-xl md:text-4xl font-black text-yellow-500 drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)] stroke-black" style={{ WebkitTextStroke: '1px black' }}>
                +{amount}
            </div>
            <div className="text-[10px] md:text-sm font-bold text-white bg-black/80 px-2 py-0.5 rounded-full uppercase border-2 border-yellow-400 transform -rotate-3 mt-1 md:mt-2">{label}</div>
        </motion.div>
    );
};

/**
 * Renders floating emotes (reactions) from other players.
 * Mimics TikTok Live hearts: each emote spawns at the sender's avatar position,
 * floats upward with a unique randomised S-curve wiggle, and fades out at the top.
 */
export const EmotePopupLayer = ({ emotes }: { emotes: Emote[] }) => {
    type LocalEmote = Emote & { addedAt: number; drift: number[] };
    const [localEmotes, setLocalEmotes] = useState<LocalEmote[]>([]);
    const seenIds = useRef<Set<string>>(new Set());
    const ANIM_DURATION = 3600;

    useEffect(() => {
        emotes.forEach(e => {
            if (!seenIds.current.has(e.id)) {
                seenIds.current.add(e.id);
                // Generate 5 random horizontal drift offsets (px) for unique S-curve per emote
                const drift = Array.from({ length: 5 }, () => (Math.random() - 0.5) * 40);
                setLocalEmotes(prev => [...prev, { ...e, addedAt: Date.now(), drift }]);
                setTimeout(() => {
                    setLocalEmotes(prev => prev.filter(le => le.id !== e.id));
                    seenIds.current.delete(e.id);
                }, ANIM_DURATION + 200);
            }
        });
    }, [emotes]);

    return (
        <div className="fixed inset-0 z-[60] pointer-events-none overflow-hidden">
            {localEmotes.map(e => {
                let expression: Expression = 'HAPPY';
                if (e.type === 'SHOCK') expression = 'SHOCKED';
                if (e.type === 'TOMATO') expression = 'ANGRY';

                const emojis: Record<string, string> = { LAUGH: '😂', SHOCK: '😮', LOVE: '❤️', TOMATO: '🍅' };
                const [d1, d2, d3, d4, d5] = e.drift;
                // Unique keyframe name per emote (id is alphanumeric safe after strip)
                const kf = `ef${e.id.replace(/[^a-z0-9]/gi, '')}`;

                return (
                    <Fragment key={e.id}>
                        {/* Inject a unique keyframe for this emote's drift path */}
                        <style>{`
                            @keyframes ${kf} {
                                0%   { transform: translate(-50%, 0)                         scale(0.6);  opacity: 0;   }
                                6%   { transform: translate(calc(-50% + ${d1}px), -4vh)     scale(1.0);  opacity: 1;   }
                                25%  { transform: translate(calc(-50% + ${d2}px), -18vh)    scale(1.0);  opacity: 1;   }
                                50%  { transform: translate(calc(-50% + ${d3}px), -35vh)    scale(0.98); opacity: 1;   }
                                75%  { transform: translate(calc(-50% + ${d4}px), -52vh)    scale(0.95); opacity: 0.7; }
                                100% { transform: translate(calc(-50% + ${d5}px), -68vh)    scale(0.92); opacity: 0;   }
                            }
                        `}</style>
                        <div
                            className="absolute flex flex-col items-center"
                            style={{
                                left: `${e.x}%`,
                                bottom: `${e.y}%`,
                                animation: `${kf} ${ANIM_DURATION}ms cubic-bezier(0.33, 0, 0.66, 1) forwards`,
                                willChange: 'transform, opacity',
                            }}
                        >
                            <div className="relative">
                                {/* Match the avatar strip size */}
                                <Avatar seed={e.senderSeed || 'guest'} size={56} expression={expression} className="filter drop-shadow-xl" />
                                <div className="absolute -top-2 -right-2 text-xl bg-white rounded-full p-0.5 shadow-md leading-none">
                                    {emojis[e.type] ?? '😂'}
                                </div>
                            </div>
                            <div className="bg-black/50 text-white px-2 py-0.5 rounded-full text-[10px] font-bold mt-1 backdrop-blur-sm uppercase whitespace-nowrap">
                                {e.senderName}
                            </div>
                        </div>
                    </Fragment>
                );
            })}
        </div>
    );
};


/**
 * Component for selecting a category when it's a player's turn.
 */
export const CategoryRoulette = ({ state, onSelect }: { state: GameState, onSelect?: (category: string) => void }) => {
    const selectorId = state.categorySelection?.selectorId;
    const selectorName = selectorId ? state.players[selectorId]?.name : 'Someone';
    const options = state.categorySelection?.options || [];
    const selected = state.categorySelection?.selected;

    return (
        <div className="flex flex-col items-center justify-start flex-1 min-h-0 w-full z-30 relative px-4">
            <div className="mt-2 text-center max-w-2xl mx-auto flex-shrink-0 pt-2 md:pt-0">
                <h2 className="text-xs md:text-xl text-purple-200 uppercase tracking-widest font-black drop-shadow-sm mb-1">{getText(state.language, 'GAME_CATEGORY_SELECTION')}</h2>
                <div className="flex flex-col items-center">
                    <span className="text-yellow-400 font-black text-2xl md:text-4xl uppercase tracking-tighter drop-shadow-xl leading-tight">{selectorName}</span>
                    <span className="text-white text-[10px] md:text-lg font-black uppercase tracking-[0.3em] mb-1 opacity-50">{onSelect ? getText(state.language, 'GAME_PICK_CATEGORY') : getText(state.language, 'GAME_IS_CHOOSING')}</span>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-4 w-full max-w-5xl px-4 md:px-6 py-2 md:py-6 pb-8 overflow-y-auto overflow-x-hidden flex-1 content-start md:content-center no-scrollbar">
                {options.map((opt, idx) => {
                    const isSelected = selected === opt;
                    const isDimmed = selected && !isSelected;
                    const isHighlight = !selected && (Math.floor(Date.now() / 300) % options.length === idx);

                    return (
                        <motion.button
                            key={opt}
                            layout
                            onClick={() => onSelect && onSelect(opt)}
                            disabled={!onSelect || !!selected}
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{
                                scale: isSelected ? 1.05 : 1,
                                opacity: isDimmed ? 0.3 : 1,
                                backgroundColor: isSelected ? '#FBBF24' : (isHighlight ? '#7C3AED' : 'rgba(30, 41, 59, 0.6)'),
                                color: isSelected ? '#000' : '#FFF',
                                borderColor: isSelected ? '#FFF' : 'rgba(255,255,255,0.1)'
                            }}
                            className={`
                                p-3 md:p-4 lg:p-6 rounded-2xl md:rounded-3xl border-2 backdrop-blur-md text-center font-black text-lg md:text-xl lg:text-2xl shadow-lg flex items-center justify-center w-full min-h-[4rem] md:min-h-[6rem] relative overflow-hidden uppercase transition-all
                                ${isSelected ? 'z-50 ring-4 ring-yellow-400/50 shadow-2xl hover:scale' : ''}
                                ${onSelect && !selected ? 'hover:scale-[1.02] active:scale-95 cursor-pointer hover:bg-purple-800/80 hover:border-purple-400' : ''}
                            `}
                        >
                            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
                            <span className={`relative z-10 leading-tight drop-shadow-md line-clamp-2 ${getAdaptiveTextClass(opt, 'text-xs md:text-2xl', 20)}`}>{opt}</span>
                        </motion.button>
                    );
                })}
            </div>
        </div>
    );
};

/**
 * Handles the animated reveal sequence of answers, votes, and authors.
 */
export const RevealSequence = ({ state, actions, setGalleryOverrides, isHost }: { state: GameState, actions: any, setGalleryOverrides: (o: Record<string, Expression>) => void, isHost: boolean }) => {
    // Safety check - if data is missing or out of sync
    if (!state.revealOrder || state.revealOrder.length === 0) {
        return <div className="flex h-full items-center justify-center text-4xl font-black text-white/20 uppercase">{getText(state.language, 'GAME_WAITING_HOST')}</div>;
    }

    const currentAnswerId = state.revealOrder[state.revealStep];
    // If step is out of bounds, we might be at end or transitioning
    if (!currentAnswerId) return null;

    const currentAnswer = state.roundAnswers.find(a => a.id === currentAnswerId);
    const phase = state.revealSubPhase || 'CARD';

    useEffect(() => {
        if (!currentAnswer) {
            setGalleryOverrides({});
            return;
        }

        const overrides: Record<string, Expression> = {};
        const isTruth = currentAnswer.authorIds.includes('SYSTEM');

        // Apply overrides based on current sub-phase from state
        currentAnswer.votes.forEach(vid => {
            if (phase === 'VOTERS') {
                overrides[vid] = isTruth ? 'HAPPY' : 'SHOCKED';
            } else if (phase === 'AUTHOR') {
                overrides[vid] = isTruth ? 'HAPPY' : 'SAD';
            } else {
                overrides[vid] = 'THINKING';
            }
        });

        if (!isTruth) {
            currentAnswer.authorIds.forEach(aid => {
                if (phase === 'AUTHOR') {
                    overrides[aid] = 'SMUG';
                } else if (phase === 'VOTERS' && currentAnswer.votes.length > 0) {
                    overrides[aid] = 'HAPPY';
                }
            });
        }

        setGalleryOverrides(overrides);
    }, [currentAnswer, phase, setGalleryOverrides]);

    if (!currentAnswer) return <div className="flex h-full items-center justify-center text-4xl font-black text-white/50">{getText(state.language, 'GAME_LOADING')}</div>;

    const isTruth = currentAnswer.authorIds.includes('SYSTEM');
    const authors = currentAnswer.authorIds.map(id => state.players[id]).filter(Boolean);
    const factParts = state.currentQuestion?.fact.split('<BLANK>') || ['', ''];
    const showFilledFact = isTruth && (phase === 'AUTHOR' || phase === 'VOTERS');
    const pointsConfig = getPointsConfig(state.currentRound, state.totalRounds);
    const audienceVoters = currentAnswer.audienceVotes.map(id => state.audience[id]).filter(Boolean);

    return (
        <div className="flex flex-col items-center justify-start flex-1 min-h-0 w-full max-w-6xl mx-auto relative z-20 px-2 md:px-4 pt-1 gap-6 md:gap-8">
            <div className="shrink-0 text-center bg-black/40 px-3 md:px-6 py-2 rounded-xl md:rounded-2xl backdrop-blur-xl border border-white/10 w-full max-w-3xl mx-auto shadow-2xl skew-y-1">
                <p className="text-[11px] md:text-lg font-bold text-gray-100 leading-snug uppercase tracking-wide">
                    {factParts[0]}
                    <AnimatePresence mode="wait">
                        {showFilledFact ? (
                            <motion.span
                                key="filled"
                                initial={{ opacity: 0, y: 10, scale: 1.5, color: '#FBBF24' }}
                                animate={{ opacity: 1, y: 0, scale: 1, color: '#FBBF24' }}
                                className="inline-block px-3 font-black underline decoration-4 decoration-yellow-400 underline-offset-4"
                            >
                                {currentAnswer.text}
                            </motion.span>
                        ) : (
                            <motion.span
                                key="blank"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="inline-block px-2 text-white/30 tracking-widest"
                            >
                                ________
                            </motion.span>
                        )}
                    </AnimatePresence>
                    {factParts[1]}
                </p>
            </div>

            <AnimatePresence mode="wait">
                <motion.div
                    key={currentAnswer.id}
                    initial={{ scale: 0.8, opacity: 0, rotate: -2 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    transition={{ type: 'spring', bounce: 0.4 }}
                    className={`relative w-full min-h-0 flex-1 max-w-xl mx-auto mb-2 rounded-3xl md:rounded-[2rem] border-4 flex flex-col items-center justify-between text-center transition-colors duration-500 uppercase overflow-hidden
                      ${isTruth && phase === 'AUTHOR'
                            ? 'bg-green-600 border-green-300 text-white shadow-[0_0_30px_2px_rgba(22,163,74,0.35)]'
                            : 'bg-white border-gray-200 text-black shadow-[0_0_30px_2px_rgba(255,255,255,0.25)]'}
                  `}
                >
                    <div className="w-full h-full flex flex-col items-center p-4 md:p-6 gap-2">
                        {/* Area 1: The Answer Text — fixed height at top */}
                        <div className="shrink-0 w-full flex items-center justify-center py-2">
                            <h2 className={`font-black leading-tight drop-shadow-sm break-words line-clamp-3 text-center ${getAdaptiveTextClass(currentAnswer.text, 'text-xl md:text-3xl lg:text-4xl', 40)}`}>
                                {currentAnswer.text}
                            </h2>
                        </div>

                        {/* Area 2: Voters — centered in flex-1 */}
                        <div className="flex-1 w-full flex flex-wrap items-center justify-center content-center gap-3 md:gap-6 min-h-0 overflow-y-auto no-scrollbar">
                            {phase !== 'CARD' && phase !== 'INTRO' && !(isTruth && phase === 'AUTHOR') && (
                                <>
                                    {/* Player Voters */}
                                    {currentAnswer.votes.map((vid, idx) => {
                                        const voter = state.players[vid];
                                        let voterExpression: Expression = 'NEUTRAL';
                                        if (phase === 'VOTERS') voterExpression = isTruth ? 'HAPPY' : 'SHOCKED';
                                        else if (phase === 'AUTHOR') voterExpression = isTruth ? 'HAPPY' : 'SAD';

                                        return (
                                            <motion.div
                                                key={vid}
                                                initial={{ y: -40, opacity: 0, scale: 0.5 }}
                                                animate={{ y: 0, opacity: 1, scale: 1 }}
                                                transition={{ delay: idx * 0.15, type: 'spring' }}
                                                className="flex flex-col items-center group shrink-0"
                                            >
                                                {/* Inline points label directly above avatar */}
                                                <AnimatePresence>
                                                    {phase === 'VOTERS' && isTruth && (
                                                        <motion.div
                                                            key="pts"
                                                            initial={{ scale: 0, opacity: 0, y: 10 }}
                                                            animate={{ scale: 1, opacity: 1, y: 0 }}
                                                            className="text-yellow-500 font-black text-sm md:text-base drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)] mb-0.5 leading-none"
                                                            style={{ WebkitTextStroke: '0.5px black' }}
                                                        >
                                                            +{pointsConfig.truth}
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>

                                                <div className="flex flex-col items-center">
                                                    <Avatar seed={voter.avatarSeed} size={80} expression={voterExpression} className="filter drop-shadow-lg !w-14 !h-14 md:!w-[70px] md:!h-[70px]" />
                                                    <div className="font-bold mt-1 text-[10px] md:text-xs break-words max-w-[64px] md:max-w-[80px] opacity-90 text-center leading-tight">{voter.name}</div>
                                                    <motion.div
                                                        initial={{ scale: 0 }} animate={{ scale: 1 }}
                                                        className={`${isTruth ? 'bg-green-600' : 'bg-red-600'} text-white font-black px-2 py-0.5 rounded-full text-[9px] md:text-[11px] uppercase shadow-md border-2 border-white whitespace-nowrap mt-1`}
                                                    >
                                                        {isTruth ? getText(state.language, 'GAME_TAG_SMART') : getText(state.language, 'GAME_TAG_FOOLED')}
                                                    </motion.div>
                                                </div>
                                            </motion.div>
                                        )
                                    })}

                                    {/* Audience Ghost Voters */}
                                    {audienceVoters.map((av, idx) => (
                                        <motion.div
                                            key={av.id}
                                            initial={{ y: -40, opacity: 0 }}
                                            animate={{ y: 0, opacity: 0.6 }}
                                            transition={{ delay: (currentAnswer.votes.length * 0.15) + (idx * 0.1), type: 'spring' }}
                                            className="flex flex-col items-center grayscale mix-blend-multiply shrink-0"
                                        >
                                            <Avatar seed={av.avatarSeed} size={50} expression={isTruth ? 'SHOCKED' : 'HAPPY'} className="filter drop-shadow-sm !w-10 !h-10 md:!w-[50px] md:!h-[50px] z-0" />
                                            <div className="bg-blue-500 text-white font-black px-2 py-0.5 rounded-full -mt-2 text-[7px] md:text-[9px] uppercase mb-1 z-10">
                                                {getText(state.language, 'GAME_TAG_AUDIENCE')}
                                            </div>
                                            <div className="text-gray-500 font-bold text-[8px] md:text-[10px] break-words max-w-[50px] md:max-w-[60px] text-center leading-tight">{av.name}</div>
                                        </motion.div>
                                    ))}
                                </>
                            )}

                            {phase !== 'CARD' && phase !== 'INTRO' && !(isTruth && phase === 'AUTHOR') && currentAnswer.votes.length === 0 && audienceVoters.length === 0 && (
                                <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="text-gray-400 font-black italic text-lg md:text-2xl uppercase tracking-tighter opacity-30 select-none">
                                    {getText(state.language, 'GAME_NO_TAKERS')}
                                </motion.div>
                            )}
                        </div>

                        {/* Area 3: Author Box at bottom of card — inline (no absolute), with reserved height to prevent layout shift */}
                        <div className="shrink-0 w-full flex flex-wrap items-center justify-center gap-2 pb-1 min-h-[3.5rem] md:min-h-[4rem]">
                            {/* Written by player(s) — with inline lie bonus points */}
                            {phase === 'AUTHOR' && !isTruth && authors.length > 0 && authors.map((author, idx) => (
                                <div key={author.id} className="flex flex-col items-center gap-1">
                                    {/* Points inline above the badge */}
                                    <AnimatePresence>
                                        {currentAnswer.votes.length > 0 && (
                                            <motion.div
                                                key="lie-pts"
                                                initial={{ scale: 0, opacity: 0, y: 6 }}
                                                animate={{ scale: 1, opacity: 1, y: 0 }}
                                                className="text-yellow-500 font-black text-sm md:text-base drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)] leading-none"
                                                style={{ WebkitTextStroke: '0.5px black' }}
                                            >
                                                +{pointsConfig.lie * currentAnswer.votes.length} <span className="text-[9px] md:text-xs font-bold text-yellow-300">LIE BONUS</span>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                    <motion.div
                                        initial={{ scale: 0, rotate: 10 }}
                                        animate={{ scale: 1, rotate: 0 }}
                                        transition={{ delay: idx * 0.1, type: "spring" }}
                                        className="flex items-center gap-1.5 md:gap-2 bg-purple-900 text-white pl-1 pr-3 md:pl-2 md:pr-5 py-1 md:py-1.5 rounded-full border-[2px] md:border-[3px] border-purple-400 uppercase shadow-xl"
                                    >
                                        <div className="border-[2px] border-white rounded-full overflow-hidden shadow-sm shrink-0">
                                            <Avatar seed={author.avatarSeed} size={40} expression={'SMUG'} className="!w-7 !h-7 md:!w-10 md:!h-10" />
                                        </div>
                                        <div className="text-left flex flex-col justify-center max-w-[90px] md:max-w-[130px]">
                                            <span className="text-[6px] md:text-[8px] font-black tracking-widest text-purple-200 mb-0.5 block truncate">{getText(state.language, 'GAME_WRITTEN_BY')}</span>
                                            <span className="text-[11px] md:text-[15px] font-black leading-none block truncate">{author.name}</span>
                                        </div>
                                    </motion.div>
                                </div>
                            ))}
                            {/* Written by bot */}
                            {phase === 'AUTHOR' && !isTruth && currentAnswer.authorIds.includes('HOST_BOT') && (
                                <motion.div
                                    key="HOST_BOT"
                                    initial={{ scale: 0, rotate: -5 }}
                                    animate={{ scale: 1, rotate: 0 }}
                                    transition={{ delay: 0.1, type: "spring" }}
                                    className="flex items-center gap-1.5 md:gap-2 bg-gray-900 text-white pl-1 pr-3 md:pl-2 md:pr-5 py-1 md:py-1.5 rounded-full border-[2px] md:border-[3px] border-gray-400 uppercase shadow-xl"
                                >
                                    <div className="border-[2px] border-white rounded-full overflow-hidden shadow-sm shrink-0">
                                        <Avatar seed={NARRATOR_SEED} size={40} expression={'SMUG'} className="!w-7 !h-7 md:!w-10 md:!h-10" />
                                    </div>
                                    <div className="text-left flex flex-col justify-center">
                                        <span className="text-[6px] md:text-[8px] font-black tracking-widest text-gray-400 mb-0.5 block">{getText(state.language, 'GAME_WRITTEN_BY')}</span>
                                        <span className="text-[11px] md:text-[15px] font-black leading-none block text-gray-200">{getText(state.language, 'GAME_NARRATOR_NAME')}</span>
                                    </div>
                                </motion.div>
                            )}

                            {/* THE TRUTH badge */}
                            {(phase === 'AUTHOR' || phase === 'VOTERS') && isTruth && (
                                <motion.div
                                    initial={{ scale: 3, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    className="text-[13px] md:text-xl font-black text-white drop-shadow-xl border-[2px] md:border-4 border-white px-4 md:px-8 py-1.5 md:py-3 bg-green-500 rounded-xl md:rounded-2xl uppercase shadow-xl transform -rotate-2"
                                >
                                    {getText(state.language, 'GAME_THE_TRUTH')}
                                </motion.div>
                            )}
                        </div>
                    </div>
                </motion.div>
            </AnimatePresence>
        </div>
    );
};

/**
 * Animated leaderboard showing sorted player scores.
 */
export const LeaderboardSequence = ({ state, actions, onHome, isHost }: { state: GameState, actions: any, onHome: () => void, isHost: boolean }) => {
    const [sortedPlayers, setSortedPlayers] = useState<Player[]>([]);
    const [showNewScores, setShowNewScores] = useState(false);

    useEffect(() => {
        // Create a defensive copy before sorting to avoid mutating state/props
        const players = Object.values(state.players || {}).filter(Boolean);

        // Helper for sorting
        const getOldScore = (p: Player) => (p.score || 0) - (p.lastRoundScore || 0);

        // Calculate initial sort (by old score)
        const initialSort = [...players].sort((a, b) => getOldScore(b) - getOldScore(a));

        // Calculate final sort (by current score)
        const finalSort = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));

        if (state.phase === GamePhase.GAME_OVER) {
            setShowNewScores(true);
            setSortedPlayers(finalSort);
        } else if (state.leaderboardPhase === 'REVEAL' || state.leaderboardPhase === 'LEADER') {
            setShowNewScores(true);
            setSortedPlayers(finalSort);
        } else {
            // Intro phase or default
            setShowNewScores(false);
            setSortedPlayers(initialSort);
        }
    }, [state.phase, state.leaderboardPhase, state.players]);

    const getRankEmotion = (p: Player, currentIdx: number): Expression => {
        if (!showNewScores) return 'NEUTRAL';
        if (p.previousRank === undefined) return 'HAPPY';
        if (currentIdx < p.previousRank) return 'HAPPY';
        if (currentIdx > p.previousRank) return 'ANGRY';
        return 'NEUTRAL';
    };

    return (
        <div className="flex flex-col items-center w-full max-w-4xl mx-auto z-20 relative">
            <h2 className="text-3xl md:text-6xl font-black text-yellow-400 mb-8 drop-shadow-lg tracking-wider uppercase">
                {state.phase === GamePhase.GAME_OVER ? getText(state.language, 'GAME_FINAL_SCORES') : getText(state.language, 'GAME_STANDINGS')}
            </h2>
            <div className="w-full space-y-4">
                <ul className="w-full space-y-4">
                    <AnimatePresence>
                        {sortedPlayers.map((p, idx) => {
                            const oldScore = p.score - p.lastRoundScore;
                            const targetScore = showNewScores ? p.score : oldScore;

                            return (
                                <motion.li
                                    key={p.id}
                                    layout
                                    initial={{ opacity: 0, y: 50 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ type: 'spring', stiffness: 45, damping: 12 }}
                                    className="bg-white text-black p-4 rounded-2xl flex items-center shadow-2xl relative overflow-hidden border-b-8 border-gray-200"
                                >
                                    <div className="w-8 md:w-16 text-2xl md:text-4xl font-black text-gray-300 italic">
                                        #{idx + 1}
                                    </div>
                                    <Avatar seed={p.avatarSeed} size={72} expression={getRankEmotion(p, idx)} className="mr-2 md:mr-6 filter drop-shadow scale-75 md:scale-100" />
                                    <div className="flex-1 uppercase">
                                        <h3 className="text-lg md:text-3xl font-bold">{p.name}</h3>
                                        {showNewScores && p.lastRoundScore > 0 && (
                                            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="text-green-600 font-bold flex items-center gap-1 text-sm md:text-base">
                                                <ArrowUp size={20} strokeWidth={4} />
                                                {p.lastRoundScore} {getText(state.language, 'GAME_PTS')}
                                            </motion.div>
                                        )}
                                    </div>
                                    <div className="text-2xl md:text-5xl font-black text-purple-700 w-20 md:w-32 text-right">
                                        <CountUp value={targetScore} from={oldScore} />
                                    </div>
                                </motion.li>
                            );
                        })}
                    </AnimatePresence>
                </ul>
            </div>
        </div>
    );
};

// --- Connection & Dev Tools ---

/**
 * Overlay shown when the host disconnects or the room is closed.
 */
export const ConnectionOverlay = ({
    hostDisconnected,
    roomClosed,
    language,
    roomCode,
    onHomeClick
}: {
    hostDisconnected: boolean;
    roomClosed: boolean;
    language: 'en' | 'el';
    roomCode?: string;
    onHomeClick?: () => void;
}) => {
    if (!hostDisconnected && !roomClosed) return null;

    const title = roomClosed
        ? getText(language, 'CONNECTION_ROOM_CLOSED')
        : getText(language, 'CONNECTION_HOST_DISCONNECTED');

    const message = roomClosed
        ? getText(language, 'CONNECTION_HOST_LEFT')
        : getText(language, 'CONNECTION_WAITING_RECONNECT');

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-8"
        >
            <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.2, type: 'spring' }}
                className="bg-gradient-to-br from-slate-800 to-slate-900 p-8 md:p-12 rounded-3xl border-4 border-white/10 shadow-2xl text-center max-w-md w-full"
            >
                {/* Icon */}
                <div className="mb-6">
                    {roomClosed ? (
                        <div className="w-20 h-20 mx-auto bg-red-500/20 rounded-full flex items-center justify-center">
                            <span className="text-5xl">🚫</span>
                        </div>
                    ) : (
                        <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
                            className="w-20 h-20 mx-auto bg-yellow-500/20 rounded-full flex items-center justify-center"
                        >
                            <span className="text-5xl">⏳</span>
                        </motion.div>
                    )}
                </div>

                {/* Title */}
                <h2 className="text-2xl md:text-3xl font-black text-white uppercase mb-2 tracking-tight">
                    {title}
                </h2>

                {/* Message */}
                <p className="text-white/60 font-bold uppercase text-sm md:text-base tracking-wider mb-6">
                    {message}
                </p>

                {/* Room Code Display */}
                {!roomClosed && roomCode && (
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-4 mb-6">
                        <p className="text-white/40 text-xs font-black uppercase tracking-widest mb-1">
                            {getText(language, 'JOIN_ENTER_CODE')}
                        </p>
                        <p className="text-3xl md:text-4xl font-black text-yellow-400 tracking-[0.2em]">
                            {roomCode}
                        </p>
                    </div>
                )}

                {/* Dots animation for waiting */}
                {!roomClosed && (
                    <div className="flex justify-center gap-2 mb-4">
                        {[0, 1, 2].map(i => (
                            <motion.div
                                key={i}
                                animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
                                transition={{ repeat: Infinity, duration: 1.5, delay: i * 0.2 }}
                                className="w-3 h-3 bg-yellow-400 rounded-full"
                            />
                        ))}
                    </div>
                )}

                {/* Home button */}
                {onHomeClick && (
                    <motion.button
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: roomClosed ? 0.5 : 3.0 }}
                        onClick={onHomeClick}
                        className="mt-4 bg-yellow-400 hover:bg-yellow-300 text-black px-8 py-4 rounded-2xl font-black text-xl uppercase shadow-lg active:scale-95 transition-transform"
                    >
                        {getText(language, 'CONNECTION_HOME')}
                    </motion.button>
                )}
            </motion.div>
        </motion.div>
    );
};

/**
 * A handy floating button only visible in Development mode to pause the game.
 */
export const DevPauseButton: React.FC<{ isPaused: boolean; onToggle: () => void }> = ({ isPaused, onToggle }) => {
    // Only show in development
    if (!import.meta.env.DEV) return null;

    return (
        <button
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation(); // Prevent affecting game flow clicks
                onToggle();
            }}
            className={`
                fixed top-28 right-0 z-[9999] px-3 py-2 rounded-l-xl font-bold text-xs uppercase shadow-xl border-l-2 border-y-2 flex items-center gap-2 transition-transform hover:scale-110
                ${isPaused ? 'bg-red-600 border-red-400 text-white' : 'bg-green-600/80 border-green-400 text-white backdrop-blur-sm'}
            `}
            title="Local Dev Pause"
        >
            {isPaused ? <Play size={16} fill="white" /> : <Pause size={16} fill="white" />}
            {isPaused ? 'RESUME' : 'PAUSE'}
        </button>
    );
};

/**
 * Modal for hosts to manage existing active rooms or start new ones.
 */
export const RoomManagerModal = ({
    rooms,
    onRejoin,
    onCreateNew,
    onCancel,
    language
}: {
    rooms: any[],
    onRejoin: (code: string) => void,
    onCreateNew: () => void,
    onCancel: () => void,
    language: 'en' | 'el'
}) => {
    const isAtLimit = rooms.length >= 2;
    const oldestRoom = [...rooms].sort((a, b) => a.createdAt - b.createdAt)[0];

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4 md:p-8"
        >
            <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="bg-slate-900 border-4 border-white/10 rounded-[2.5rem] shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            >
                {/* Header */}
                <div className="p-6 md:p-8 text-center border-b border-white/5 relative">
                    <h2 className="text-2xl md:text-4xl font-black text-yellow-400 uppercase tracking-tight mb-2">
                        {language === 'en' ? 'Manage Your Games' : 'Διαχείριση Παιχνιδιών'}
                    </h2>
                    <p className="text-white/60 font-bold uppercase text-xs md:text-sm tracking-widest">
                        {language === 'en'
                            ? `You have ${rooms.length} active game${rooms.length > 1 ? 's' : ''} running.`
                            : `Έχετε ${rooms.length} ενεργ${rooms.length > 1 ? 'ά' : 'ό'} παιχνίδι${rooms.length > 1 ? 'α' : ''}.`}
                    </p>
                </div>

                {/* Room List */}
                <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-4 no-scrollbar">
                    {rooms.map((rm) => (
                        <div
                            key={rm.roomCode}
                            onClick={() => onRejoin(rm.roomCode)}
                            className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-3xl p-5 transition-all group flex flex-col md:flex-row items-center gap-6 cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
                        >
                            <div className="text-center md:text-left shrink-0">
                                <span className="text-xs font-black text-white/30 uppercase tracking-[0.3em] block mb-1">CODE</span>
                                <span className="text-4xl md:text-5xl font-black text-yellow-400 tracking-widest">{rm.roomCode}</span>
                            </div>

                            <div className="flex-1 min-w-0 text-center md:text-left">
                                <div className="flex flex-wrap justify-center md:justify-start gap-2 mb-3">
                                    <span className="bg-purple-600/50 text-white text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-tighter">
                                        {rm.phase}
                                    </span>
                                    <span className="bg-blue-600/50 text-white text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-tighter">
                                        {rm.playerCount} {language === 'en' ? 'Players' : 'Παίκτες'}
                                    </span>

                                </div>
                                <div className="text-white/40 text-[11px] font-bold uppercase tracking-wide truncate">
                                    {rm.playerNames?.join(', ') || (language === 'en' ? 'No players yet' : 'Κανένας παίκτης ακόμα')}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Footer / Actions */}
                <div className="p-6 md:p-8 bg-black/40 border-t border-white/5">
                    {isAtLimit && oldestRoom && (
                        <p className="text-center text-red-400 text-[10px] md:text-xs font-bold uppercase tracking-widest mb-4 mx-auto max-w-md">
                            ⚠️ {language === 'en'
                                ? `Starting a new room will push oldest room ${oldestRoom.roomCode} into a 60s grace period.`
                                : `Ξεκινώντας νέο δωμάτιο, το παλαιότερο ${oldestRoom.roomCode} θα μπει σε 60δ χάρη.`}
                        </p>
                    )}
                    <button
                        onClick={onCreateNew}
                        className="w-full bg-yellow-400 hover:bg-yellow-300 text-slate-900 py-4 rounded-2xl font-black text-lg md:text-xl uppercase shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3 group mb-4"
                    >
                        <span>{language === 'en' ? 'START NEW GAME' : 'ΝΕΟ ΠΑΙΧΝΙΔΙ'}</span>

                    </button>

                    <button
                        onClick={onCancel}
                        className="w-full bg-white/5 hover:bg-white/10 text-white/40 hover:text-white py-3 rounded-2xl font-bold text-sm uppercase transition-all active:scale-95"
                    >
                        {language === 'en' ? 'GO BACK' : 'ΠΙΣΩ'}
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
};
