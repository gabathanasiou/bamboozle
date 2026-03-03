import React, { useState, useEffect } from 'react';
import { GameState, GamePhase } from '../types';
import { Avatar } from '../components/Avatar';
import { Clock, Users, CheckCircle, Lock, Play, Minus, Plus, RotateCcw, Crown, Home } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { sfx } from '../services/audioService';
import { getText } from '../i18n';
import { GameBackground, ConnectionOverlay } from './GameSharedComponents';

interface PlayerViewProps {
    state: GameState;
    actions: any;
    playerId: string;
    hostDisconnected?: boolean;
    roomClosed?: boolean;
    onHome?: () => void;
}

export const PlayerView: React.FC<PlayerViewProps> = ({ state, actions, playerId, hostDisconnected, roomClosed, onHome }) => {
    // Game Interactions State
    const [lieText, setLieText] = useState('');
    const [showTruthWarning, setShowTruthWarning] = useState(false);
    const [myEmoteExpression, setMyEmoteExpression] = useState<'NEUTRAL' | 'HAPPY' | 'SHOCKED' | 'ANGRY' | null>(null);
    const [selectedRounds, setSelectedRounds] = useState(3);

    // Entry Flow State
    const [joinStep, setJoinStep] = useState<'CODE' | 'NAME'>('CODE');
    const [inputCode, setInputCode] = useState('');
    const [joinName, setJoinName] = useState('');
    const [codeError, setCodeError] = useState('');
    const [rejoinCode, setRejoinCode] = useState<string | null>(null);

    const me = state.players[playerId];
    const amAudience = state.audience[playerId];
    const isJoined = !!me || !!amAudience;

    // Check for rejoinable session
    useEffect(() => {
        import.meta.env.DEV && console.log('[PlayerView] Session check effect. isJoined:', isJoined, 'joinStep:', joinStep, 'actions available:', !!actions);
        if (isJoined || joinStep !== 'CODE') return;

        const storedCode = localStorage.getItem('bamboozle_room_code');
        import.meta.env.DEV && console.log('[PlayerView] Stored room code in localStorage:', storedCode);
        if (storedCode && storedCode.length === 4) {
            actions.checkRoomExists(storedCode, (exists: boolean) => {
                import.meta.env.DEV && console.log('[PlayerView] Room check result for', storedCode, ':', exists);
                if (exists) {
                    setRejoinCode(storedCode);
                } else {
                    localStorage.removeItem('bamboozle_room_code');
                }
            });
        }
    }, [isJoined, joinStep, actions]);

    // Reset lie text between rounds
    useEffect(() => {
        setLieText('');
        setShowTruthWarning(false);
    }, [state.currentRound, state.phase]);

    // Sync selected rounds if changed remotely
    useEffect(() => {
        if (state.totalRounds) {
            setSelectedRounds(state.totalRounds);
        }
    }, [state.totalRounds]);

    // Handle self-emote display
    const handleEmote = (type: 'LAUGH' | 'SHOCK' | 'LOVE' | 'TOMATO') => {
        const name = me ? me.name : (amAudience ? amAudience.name : 'Unknown');
        const seed = me ? me.avatarSeed : (amAudience ? amAudience.avatarSeed : 'unknown');
        actions.sendEmote(type, name, seed);
        sfx.play('CLICK');

        // Local feedback
        if (type === 'SHOCK') setMyEmoteExpression('SHOCKED');
        else if (type === 'TOMATO') setMyEmoteExpression('ANGRY');
        else setMyEmoteExpression('HAPPY');

        setTimeout(() => setMyEmoteExpression(null), 2000);
    };

    const submitLie = () => {
        if (!state.currentQuestion) return;
        const cleanLie = lieText.trim().toLowerCase();
        const cleanAnswer = state.currentQuestion.answer.toLowerCase();

        // Simple fuzzy check
        if (cleanLie === cleanAnswer || cleanAnswer.includes(cleanLie) && cleanLie.length > 3) {
            setShowTruthWarning(true);
            sfx.play('FAILURE');
            setTimeout(() => setShowTruthWarning(false), 3000);
            return;
        }

        actions.sendLie(lieText);
    };

    const updateRounds = (val: number) => {
        setSelectedRounds(val);
        actions.sendUpdateRounds(val);
        sfx.play('CLICK');
    };

    const handleAvatarClick = () => {
        if (actions.requestSync) {
            actions.requestSync((success: boolean) => {
                if (success) {
                    sfx.play('JOIN');
                } else {
                    sfx.play('FAILURE'); // Cooldown
                }
            });
        }
    };

    // Determine avatar expression (local override vs server state)
    const currentExpression = myEmoteExpression || (me ? me.expression : 'NEUTRAL');

    const EmoteGrid = () => (
        <div className="grid grid-cols-4 gap-2 w-full mt-4">
            <button onClick={() => handleEmote('LAUGH')} className="bg-gray-800 p-3 rounded-xl hover:bg-gray-700 text-2xl active:scale-95 transition">😂</button>
            <button onClick={() => handleEmote('SHOCK')} className="bg-gray-800 p-3 rounded-xl hover:bg-gray-700 text-2xl active:scale-95 transition">😮</button>
            <button onClick={() => handleEmote('LOVE')} className="bg-gray-800 p-3 rounded-xl hover:bg-gray-700 text-2xl active:scale-95 transition">❤️</button>
            <button onClick={() => handleEmote('TOMATO')} className="bg-gray-800 p-3 rounded-xl hover:bg-gray-700 text-2xl active:scale-95 transition">🍅</button>
        </div>
    );

    let content;

    // --- UNIFIED JOIN FLOW ---
    if (!isJoined) {
        content = (
            <GameBackground className="h-full min-h-safe-screen flex flex-col items-center justify-center p-6 relative overflow-hidden">
                <div className="w-full max-w-md space-y-8 relative z-10 w-full">
                    <div className="text-center">
                        <h1 className="text-5xl font-display text-yellow-400 mb-2 drop-shadow-md tracking-tighter transform -rotate-2">Bamboozle</h1>
                        <p className="text-white/60 uppercase tracking-widest text-xs font-bold">Party Game</p>
                    </div>

                    {joinStep === 'CODE' && (
                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                            <div className="bg-white/10 backdrop-blur-lg p-6 rounded-3xl border border-white/20 shadow-xl">
                                <label className="block text-center text-white/80 mb-4 uppercase text-sm font-bold tracking-wider">Room Code</label>
                                <input
                                    type="text"
                                    placeholder="ABCD"
                                    className="w-full p-4 text-center text-4xl font-black rounded-xl uppercase tracking-[0.5em] bg-white text-black placeholder-gray-300 border-4 border-transparent focus:border-yellow-400 outline-none transition-all shadow-xl"
                                    maxLength={4}
                                    value={inputCode}
                                    autoComplete="off"
                                    autoCorrect="off"
                                    autoCapitalize="characters"
                                    spellCheck={false}
                                    inputMode="text"
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
                            </div>

                            {codeError && (
                                <div className="text-red-300 text-center font-bold animate-pulse uppercase bg-red-900/50 py-2 rounded-lg">
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
                                    className="w-full bg-white/10 hover:bg-white/20 border-2 border-dashed border-yellow-400/50 p-4 rounded-2xl flex items-center justify-between group transition-all"
                                >
                                    <div className="text-left">
                                        <p className="text-[10px] font-black text-yellow-400 uppercase tracking-widest opacity-80">{getText(state.language, 'JOIN_ACTIVE_GAME')}</p>
                                        <p className="text-2xl font-black text-white tracking-[0.2em]">{rejoinCode}</p>
                                    </div>
                                    <div className="bg-yellow-400 text-black p-2 rounded-lg group-hover:scale-110 transition-transform">
                                        <RotateCcw size={20} />
                                    </div>
                                </motion.button>
                            )}

                            <button
                                onClick={() => {
                                    const codeToUse = inputCode || rejoinCode;
                                    if (!codeToUse) return;

                                    actions.joinRoom(codeToUse, (success: boolean, error?: string, becameHost?: boolean) => {
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
                                className="w-full bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 disabled:bg-gray-400 text-black py-5 rounded-2xl font-black text-2xl shadow-lg uppercase tracking-wide transform active:scale-95 transition-all"
                            >
                                {getText(state.language, 'JOIN_BTN_ENTER')}
                            </button>

                            <button
                                onClick={() => {
                                    sfx.play('CLICK');
                                    window.location.reload();
                                }}
                                className="w-full bg-white/10 hover:bg-white/20 text-white py-4 rounded-2xl font-bold text-lg border border-white/20 uppercase tracking-wide transform active:scale-95 transition-all flex items-center justify-center gap-2"
                            >
                                <Home size={20} /> Cancel
                            </button>
                        </motion.div>
                    )}

                    {joinStep === 'NAME' && (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                            <div className="bg-white/10 p-6 rounded-3xl text-center backdrop-blur-lg border border-white/20 shadow-xl relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-green-400 to-blue-500" />
                                <p className="text-xs font-bold text-white/60 mb-2 uppercase tracking-widest">Joining Room</p>
                                <p className="text-5xl font-black text-white tracking-widest drop-shadow-sm">{state.roomCode}</p>
                                {state.phase !== GamePhase.LOBBY && (
                                    <div className="mt-3 text-yellow-400 font-bold uppercase text-xs animate-pulse bg-yellow-400/10 inline-block px-3 py-1 rounded-full">
                                        In Progress
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2">
                                <label className="block ml-2 text-white/80 uppercase text-xs font-bold tracking-wider">Your Name</label>
                                <input
                                    type="text"
                                    placeholder="NICKNAME"
                                    className="w-full p-5 text-center text-2xl font-black rounded-2xl bg-white text-black placeholder-gray-300 uppercase shadow-lg border-4 border-transparent focus:border-purple-400 outline-none"
                                    value={joinName}
                                    autoComplete="nickname"
                                    autoCorrect="off"
                                    autoCapitalize="characters"
                                    spellCheck={false}
                                    inputMode="text"
                                    onChange={e => setJoinName(e.target.value.toUpperCase())}
                                    onCompositionEnd={(e) => setJoinName((e.target as HTMLInputElement).value.toUpperCase())}
                                    maxLength={12}
                                />
                            </div>

                            {state.phase === GamePhase.LOBBY ? (
                                <div className="space-y-4 pt-2">
                                    {/* Join as Player if Lobby */}
                                    <button
                                        disabled={!joinName || Object.keys(state.players).length >= 6}
                                        onClick={() => { sfx.play('CLICK'); actions.sendJoin(joinName, joinName); }}
                                        className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 text-white py-5 rounded-2xl font-black text-2xl shadow-xl transform transition active:scale-95 disabled:opacity-50 disabled:transform-none uppercase tracking-wide flex items-center justify-center relative overflow-hidden group"
                                    >
                                        <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                                        {Object.keys(state.players).length >= 6 ? 'Game Full' : 'Join Game'}
                                    </button>

                                    <button
                                        disabled={!joinName}
                                        onClick={() => { sfx.play('CLICK'); actions.sendJoinAudience(joinName, joinName); }}
                                        className="w-full bg-blue-600/20 hover:bg-blue-600/40 text-blue-200 hover:text-white py-4 rounded-2xl font-bold text-lg border-2 border-blue-500/30 flex items-center justify-center gap-2 transform transition active:scale-95 disabled:opacity-50 uppercase"
                                    >
                                        <Users size={20} /> Join Audience
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {/* Only Join Audience if In Progress */}
                                    <button
                                        disabled={!joinName}
                                        onClick={() => { sfx.play('CLICK'); actions.sendJoinAudience(joinName, joinName); }}
                                        className="w-full bg-blue-600 hover:bg-blue-500 text-white py-5 rounded-2xl font-black text-xl shadow-lg flex items-center justify-center gap-2 transform transition active:scale-95 disabled:opacity-50 uppercase"
                                    >
                                        <Users size={24} /> Join Audience
                                    </button>
                                    <p className="text-center text-white/50 text-xs uppercase font-bold">
                                        Late players must watch first
                                    </p>
                                </div>
                            )}

                            <button onClick={() => setJoinStep('CODE')} className="w-full text-center text-white/30 text-xs font-bold hover:text-white uppercase transition-colors">
                                Wrong Code?
                            </button>
                        </motion.div>
                    )}
                </div>
            </GameBackground>
        );
    }

    // --- LOBBY WAIT (READY/START) ---
    else if (state.phase === GamePhase.LOBBY && me) {
        const allPlayers = Object.values(state.players);
        const allReady = allPlayers.length > 0 && allPlayers.every(p => p.isReady);
        const amIHost = state.vipId === playerId;
        const readyCount = allPlayers.filter(p => p.isReady).length;

        content = (
            <div className="h-full bg-indigo-900 text-white flex flex-col items-center pt-safe-top pb-safe-bottom px-6 min-h-safe-screen relative overflow-hidden">
                <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

                <div className="flex-1 flex flex-col items-center justify-center w-full max-w-md z-10">

                    {/* Clean Avatar Display (No Square Box) */}
                    <div className="relative mb-8 cursor-pointer group" onClick={handleAvatarClick} title="Tap to Sync">
                        {amIHost && (
                            <div className="absolute -top-12 left-1/2 -translate-x-1/2 text-yellow-400 drop-shadow-lg flex flex-col items-center animate-bounce-subtle z-20">
                                <Crown size={40} fill="currentColor" />
                                <span className="text-[10px] font-black uppercase mt-0.5 bg-black/60 px-2 py-0.5 rounded-full border border-yellow-400/50">VIP Host</span>
                            </div>
                        )}
                        <div className="absolute inset-0 bg-white/5 rounded-full blur-xl transform group-active:scale-110 transition-transform" />
                        <Avatar seed={me.avatarSeed} size={150} expression={currentExpression} className="filter drop-shadow-2xl relative z-10" />
                    </div>

                    <h2 className="text-4xl font-black mb-2 uppercase tracking-wide text-transparent bg-clip-text bg-gradient-to-b from-white to-gray-300">{me.name}</h2>
                    <div className="text-white/40 text-sm font-bold uppercase tracking-widest mb-10">
                        Room: {state.roomCode}
                    </div>

                    <button
                        onClick={actions.sendToggleReady}
                        className={`w-full py-6 rounded-[2rem] font-black text-3xl shadow-2xl mb-6 transition-all transform active:scale-95 uppercase relative overflow-hidden group ${me.isReady
                            ? 'bg-gray-800 text-gray-400 border-4 border-gray-700'
                            : 'bg-green-500 hover:bg-green-400 text-white shadow-[0_10px_40px_-10px_rgba(34,197,94,0.6)]'
                            }`}
                    >
                        <span className="relative z-10">{me.isReady ? 'Ready!' : 'I\'m Ready!'}</span>
                    </button>

                    <div className="text-center mb-8">
                        <p className="text-xs font-bold text-white/50 uppercase tracking-widest mb-2">Players Ready</p>
                        <div className="flex items-center gap-1 justify-center">
                            {Array.from({ length: Math.max(Object.keys(state.players).length, 1) }).map((_, i) => (
                                <div key={i} className={`h-2 w-8 rounded-full transition-colors ${i < readyCount ? 'bg-green-500 box-shadow-glow' : 'bg-white/10'}`} />
                            ))}
                        </div>
                    </div>

                    {amIHost && (
                        <div className="w-full space-y-4 bg-black/20 p-6 rounded-3xl backdrop-blur-md border border-white/10">
                            <div className="flex items-center justify-between mb-2">
                                <span className="font-bold uppercase text-xs text-white/60 tracking-wider">Rounds</span>
                                <div className="flex items-center gap-4 bg-black/30 rounded-full p-1">
                                    <button onClick={() => updateRounds(Math.max(1, selectedRounds - 1))} className="w-10 h-10 flex items-center justify-center bg-white/10 rounded-full hover:bg-white/20 active:bg-white/30 transition-colors"><Minus size={18} /></button>
                                    <span className="font-black text-xl w-6 text-center">{selectedRounds}</span>
                                    <button onClick={() => updateRounds(Math.min(10, selectedRounds + 1))} className="w-10 h-10 flex items-center justify-center bg-white/10 rounded-full hover:bg-white/20 active:bg-white/30 transition-colors"><Plus size={18} /></button>
                                </div>
                            </div>
                            <div className="text-center text-[10px] text-white/30 font-bold uppercase mb-4">
                                ~{Math.ceil(selectedRounds * 2.5)} Minutes
                            </div>

                            <button
                                disabled={!allReady}
                                onClick={() => { sfx.play('CLICK'); actions.sendStartGame(selectedRounds); }}
                                className="w-full bg-yellow-400 hover:bg-yellow-300 disabled:opacity-30 disabled:cursor-not-allowed text-black py-4 rounded-2xl font-black text-xl shadow-xl flex items-center justify-center gap-3 uppercase transition-all"
                            >
                                <Play size={24} fill="currentColor" /> Start Game
                            </button>
                        </div>
                    )}
                    {amIHost && !allReady && <p className="text-[10px] mt-4 text-center text-white/40 font-bold uppercase">Waiting for everyone to ready up</p>}
                    {!amIHost && <p className="text-[10px] mt-4 text-center text-white/40 font-bold uppercase">Waiting for host to start</p>}
                </div>
            </div>
        );
    }

    // --- AUDIENCE VIEW ---
    else if (amAudience) {
        content = (
            <div className="h-full bg-slate-900 text-white flex flex-col relative overflow-hidden min-h-safe-screen">
                {/* Header */}
                <div className="bg-slate-800/80 backdrop-blur-md px-6 pt-safe-top pb-4 flex items-center justify-between border-b border-white/5 z-20">
                    <div className="flex items-center gap-3">
                        <div className="bg-blue-500 text-[10px] font-black px-2 py-0.5 rounded-md uppercase tracking-wide">Viewer</div>
                        <h2 className="font-bold leading-none uppercase text-lg">{amAudience.name}</h2>
                    </div>
                    <div className="bg-black/30 px-3 py-1 rounded-full text-xs font-bold text-slate-400 uppercase tracking-wider">
                        {state.phase}
                    </div>
                </div>

                {/* Main Content */}
                <div className="flex-1 flex flex-col items-center justify-start pb-safe-bottom overflow-y-auto w-full relative px-6 pt-8">

                    {/* Big Avatar for Audience */}
                    <div className="mb-8 relative cursor-pointer" onClick={handleAvatarClick} title="Tap to Sync">
                        <div className="absolute inset-0 bg-blue-500 blur-3xl opacity-10 rounded-full animate-pulse" />
                        <Avatar seed={amAudience.avatarSeed} size={120} className="relative z-10 drop-shadow-2xl grayscale hover:grayscale-0 transition-all duration-500" expression={currentExpression || 'NEUTRAL'} />
                    </div>

                    {state.phase === GamePhase.VOTING && (
                        <div className="w-full max-w-lg space-y-4">
                            <div className="text-center mb-6">
                                <h3 className="text-3xl font-black text-yellow-400 mb-2 uppercase tracking-tight">Cheat The System</h3>
                                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Vote for a lie to trick players!</p>
                            </div>
                            {state.roundAnswers.map(ans => {
                                // Check if I voted for this
                                const iVoted = ans.audienceVotes.includes(playerId);
                                return (
                                    <button
                                        key={ans.id}
                                        onClick={() => { sfx.play('CLICK'); actions.sendAudienceVote(ans.id); }}
                                        className={`w-full p-5 border-2 rounded-2xl font-bold text-lg transition-all text-left flex justify-between items-center group active:scale-95 uppercase
                                        ${iVoted ? 'bg-blue-600 border-blue-400 text-white shadow-lg' : 'bg-slate-800 border-slate-700 hover:border-blue-500 text-slate-200'}
                                    `}
                                    >
                                        <span className="truncate mr-2 leading-tight">{ans.text}</span>
                                        {iVoted && <CheckCircle size={24} className="text-white" strokeWidth={3} />}
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {(state.phase === GamePhase.WRITING || state.phase === GamePhase.CATEGORY_SELECT || state.phase === GamePhase.LOBBY) && (
                        <div className="text-center opacity-60 mt-4 bg-white/5 p-6 rounded-3xl border border-white/5">
                            <h3 className="text-xl font-bold text-blue-200 mb-2 uppercase">Enjoy the show!</h3>
                            <p className="text-xs uppercase font-bold tracking-widest">React below to let them know how you feel.</p>
                        </div>
                    )}

                    {state.phase === GamePhase.REVEAL && (
                        <div className="text-center mt-6 w-full">
                            <div className="bg-green-500/10 border border-green-500/50 p-8 rounded-3xl animate-pulse">
                                <p className="text-2xl text-green-400 font-black uppercase mb-2">Truth Revealed</p>
                                <p className="text-xs font-bold uppercase tracking-widest text-green-200/60">Watch the main screen</p>
                            </div>
                        </div>
                    )}

                    <div className="mt-auto w-full pb-4 pt-8">
                        <p className="text-center text-[10px] uppercase tracking-[0.2em] font-bold opacity-30 mb-4">Live Reactions</p>
                        <EmoteGrid />
                    </div>
                </div>
            </div>
        );
    }

    // --- PLAYER: CATEGORY SELECTION ---
    else if (state.phase === GamePhase.CATEGORY_SELECT) {
        const isSelector = state.categorySelection?.selectorId === playerId;
        const options = state.categorySelection?.options || [];
        const hasSelected = !!state.categorySelection?.selected;

        if (isSelector) {
            if (hasSelected) {
                content = (
                    <div className="h-full bg-indigo-900 text-white flex flex-col items-center justify-center p-8 text-center min-h-safe-screen">
                        <h2 className="text-4xl font-black mb-4 uppercase drop-shadow-lg">Locked In!</h2>
                        <p className="text-xl opacity-75 uppercase font-bold tracking-wider">Good luck...</p>
                        <div className="mt-12 w-full">
                            <EmoteGrid />
                        </div>
                    </div>
                );
            }

            content = (
                <div className="h-full bg-indigo-900 text-white flex flex-col p-6 pt-safe-top pb-safe-bottom min-h-safe-screen overflow-hidden">
                    <div className="text-center mb-8 mt-4 relative z-10">
                        <div className="inline-block bg-yellow-400 text-indigo-900 px-4 py-1 rounded-full font-black uppercase text-sm mb-2 shadow-lg">Your Turn</div>
                        <h2 className="text-3xl font-black text-white uppercase tracking-tight leading-none mb-2">Pick a Category</h2>
                        <div className="mt-2 text-sm font-bold flex items-center justify-center gap-2 bg-black/30 w-fit mx-auto px-4 py-1.5 rounded-full border border-white/10">
                            <Clock size={16} className="text-yellow-400" /> {state.timeLeft}s
                        </div>
                    </div>

                    <div className="flex-1 grid grid-cols-1 gap-4 overflow-y-auto pb-4 px-2">
                        {options.map((opt, i) => (
                            <button
                                key={opt}
                                onClick={() => { sfx.play('CLICK'); actions.sendCategorySelection(opt); }}
                                className="bg-white/10 hover:bg-white/20 backdrop-blur-md text-white p-6 rounded-3xl font-black text-2xl shadow-xl active:scale-95 transition-all uppercase border-2 border-white/5 relative overflow-hidden group text-left"
                                style={{ animationDelay: `${i * 100}ms` }}
                            >
                                <div className="absolute right-0 top-0 bottom-0 w-2 bg-gradient-to-b from-yellow-400 to-purple-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                                {opt}
                            </button>
                        ))}
                    </div>
                </div>
            );
        } else {
            const selectorName = state.categorySelection?.selectorId ? state.players[state.categorySelection.selectorId]?.name : 'Someone';

            content = (
                <div className="h-full bg-indigo-900 text-white flex flex-col items-center justify-center p-8 text-center space-y-8 min-h-safe-screen">
                    <div className="relative">
                        <div className="absolute inset-0 bg-white/10 rounded-full blur-3xl animate-pulse" />
                        <Avatar seed={state.players[state.categorySelection?.selectorId || '']?.avatarSeed || 'unknown'} size={140} expression={currentExpression} className="relative z-10 drop-shadow-2xl" />
                    </div>

                    <div className="bg-black/20 p-6 rounded-3xl border border-white/10 backdrop-blur-sm max-w-xs w-full">
                        <h2 className="text-2xl font-black mb-1 uppercase tracking-tight">{selectorName}</h2>
                        <p className="opacity-60 uppercase text-xs font-bold tracking-widest">is choosing a category...</p>
                    </div>

                    <div className="w-full max-w-xs">
                        <EmoteGrid />
                    </div>
                </div>
            );
        }
    }

    // --- PLAYER: WAITING SCREENS ---
    else if ((state.phase === GamePhase.WRITING && state.submittedLies[playerId]) ||
        (state.phase === GamePhase.VOTING && me.currentVote) ||
        state.phase === GamePhase.INTRO ||
        state.phase === GamePhase.REVEAL ||
        state.phase === GamePhase.LEADERBOARD ||
        state.phase === GamePhase.GAME_OVER) {

        let message = "Waiting for Host...";
        let subtext = "Hang tight!";

        if (state.phase === GamePhase.WRITING) { message = "Lie Submitted!"; subtext = "Hope they fall for it..."; }
        if (state.phase === GamePhase.VOTING) { message = "Vote Locked!"; subtext = "Fingers crossed."; }
        if (state.phase === GamePhase.INTRO) { message = "Look Up!"; subtext = "Read the question."; }
        if (state.phase === GamePhase.REVEAL) { message = "The Reveal"; subtext = "Did you fool them?"; }
        if (state.phase === GamePhase.GAME_OVER) { message = "Game Over!"; subtext = "Check the final scores."; }

        const isVip = state.vipId === playerId;

        content = (
            <div className="h-full bg-indigo-950 text-white flex flex-col items-center p-8 pt-safe-top pb-safe-bottom min-h-safe-screen relative overflow-hidden">
                <div className="absolute inset-0 opacity-20 pointer-events-none bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-purple-800 via-indigo-950 to-black" />

                <div className="flex-1 flex flex-col items-center justify-center space-y-8 relative z-10 w-full max-w-md">

                    {/* Clean Avatar Display */}
                    <div className="relative cursor-pointer group" onClick={handleAvatarClick} title="Tap to Sync">
                        <div className="absolute inset-0 bg-white/5 rounded-full blur-2xl group-hover:bg-white/10 transition-colors" />
                        <Avatar seed={me.avatarSeed} size={160} expression={currentExpression} className="filter drop-shadow-2xl relative z-10" />
                    </div>

                    <div className="text-center">
                        <h2 className="text-4xl font-black uppercase mb-6 tracking-tight">{me.name}</h2>
                        <div className="bg-white/5 p-8 rounded-[2rem] text-center backdrop-blur-md border border-white/10 shadow-2xl w-full">
                            <p className="text-2xl font-black animate-pulse uppercase text-yellow-400 mb-2">{message}</p>
                            <p className="text-sm font-bold uppercase text-white/50 tracking-widest">{subtext}</p>
                        </div>
                    </div>

                    {state.phase === GamePhase.GAME_OVER && isVip && (
                        <div className="space-y-4 w-full mt-4">
                            <button onClick={() => { sfx.play('CLICK'); actions.sendRestart(); }} className="w-full bg-green-500 hover:bg-green-600 text-white py-5 rounded-2xl font-black text-xl shadow-lg flex items-center justify-center gap-2 uppercase active:scale-95 transition-transform">
                                <RotateCcw size={24} strokeWidth={3} /> Play Again
                            </button>
                            <button onClick={() => window.location.reload()} className="w-full bg-white/10 hover:bg-white/20 text-white py-4 rounded-2xl font-bold text-lg border border-white/5 flex items-center justify-center gap-2 uppercase active:scale-95 transition-transform">
                                <Home size={20} /> Exit Room
                            </button>
                        </div>
                    )}
                    {state.phase === GamePhase.GAME_OVER && !isVip && (
                        <p className="text-xs opacity-40 uppercase font-bold tracking-widest mt-4">Waiting for VIP to restart...</p>
                    )}

                </div>
                <div className="w-full text-center mb-6">
                    {(state.phase === GamePhase.LEADERBOARD || state.phase === GamePhase.GAME_OVER) && (
                        <div className="inline-block bg-black/40 px-6 py-2 rounded-full border border-white/10">
                            <span className="text-xs font-bold text-gray-400 uppercase mr-2">Your Score</span>
                            <span className="text-2xl font-black text-white">{me.score}</span>
                        </div>
                    )}
                </div>
                <div className="w-full max-w-md">
                    <EmoteGrid />
                </div>
            </div>
        );
    }

    // --- PLAYER: WRITING PHASE ---
    else if (state.phase === GamePhase.WRITING) {
        content = (
            <div className="h-full bg-indigo-950 text-white p-6 pt-safe-top pb-safe-bottom flex flex-col relative overflow-hidden min-h-safe-screen">
                <div className="absolute inset-0 z-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

                <AnimatePresence>
                    {showTruthWarning && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-red-900/95 z-50 flex flex-col items-center justify-center text-center p-8 backdrop-blur-md"
                        >
                            <Lock size={80} className="mb-6 text-red-200" strokeWidth={1.5} />
                            <h2 className="text-5xl font-black text-white mb-4 uppercase tracking-tighter">Shhhhh!</h2>
                            <p className="text-2xl text-red-100 uppercase font-bold leading-snug">That's the actual truth!<br /><span className="text-lg opacity-80 mt-2 block font-normal">Write a lie instead.</span></p>
                        </motion.div>
                    )}
                </AnimatePresence>

                <div className="flex justify-between items-center mb-6 relative z-10 w-full bg-black/20 p-4 rounded-2xl backdrop-blur-sm border border-white/10">
                    <span className="font-bold text-indigo-200 uppercase tracking-widest text-xs">Round {state.currentRound}</span>
                    <div className="flex items-center text-yellow-400 font-black gap-2 text-xl">
                        <Clock size={24} /> {state.timeLeft}
                    </div>
                </div>

                <div className="bg-white/10 backdrop-blur-md text-white p-8 rounded-[2rem] mb-6 shadow-xl border border-white/20 relative z-10 transform -rotate-1">
                    <p className="text-xl font-bold leading-relaxed uppercase tracking-wide">
                        {state.currentQuestion?.fact.replace('<BLANK>', '________')}
                    </p>
                </div>

                <div className="flex-1 relative z-10">
                    <label className="block text-xs font-bold uppercase tracking-[0.2em] mb-3 text-indigo-300 ml-2">Enter your Lie</label>
                    <textarea
                        className="w-full p-6 rounded-[2rem] text-2xl font-black h-48 resize-none focus:ring-4 focus:ring-yellow-400 outline-none bg-white text-black placeholder-gray-300 uppercase shadow-inner leading-snug"
                        placeholder="MAKE IT BELIEVABLE..."
                        value={lieText}
                        autoComplete="off"
                        autoCorrect="on"
                        autoCapitalize="sentences"
                        spellCheck={true}
                        inputMode="text"
                        onChange={e => setLieText(e.target.value)}
                        onCompositionEnd={(e) => setLieText((e.target as HTMLTextAreaElement).value)}
                    />
                </div>

                <button
                    onClick={submitLie}
                    disabled={!lieText.trim()}
                    className="w-full bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-300 hover:to-amber-400 text-indigo-950 py-6 rounded-2xl font-black text-2xl shadow-xl mt-6 disabled:opacity-50 disabled:cursor-not-allowed uppercase relative overflow-hidden group active:scale-95 transition-all z-20"
                >
                    <span className="relative z-10 flex items-center justify-center gap-2">Submit Lie <CheckCircle size={24} strokeWidth={3} /></span>
                </button>
            </div>
        );
    }

    // --- PLAYER: VOTING PHASE ---
    else if (state.phase === GamePhase.VOTING) {
        const choices = state.roundAnswers.filter(a => !a.authorIds.includes(playerId));

        content = (
            <div className="h-full bg-slate-900 text-white p-4 pt-safe-top pb-safe-bottom flex flex-col min-h-safe-screen relative overflow-hidden">
                <div className="absolute inset-0 z-0 opacity-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-blue-500 to-transparent" />

                <div className="bg-slate-800/80 backdrop-blur-md p-6 rounded-[2rem] mb-6 border border-white/10 shadow-lg relative z-10">
                    <p className="text-xs font-bold opacity-60 mb-2 uppercase tracking-widest text-blue-300">The Fact</p>
                    <p className="font-bold text-xl leading-snug uppercase">
                        {state.currentQuestion?.fact.replace('<BLANK>', '________')}
                    </p>
                </div>

                <div className="text-center mb-6 relative z-10">
                    <h2 className="text-4xl font-black uppercase text-yellow-400 tracking-tighter drop-shadow-md">Spot the Truth</h2>
                    <p className="text-[10px] font-bold opacity-60 uppercase tracking-[0.3em] bg-black/30 inline-block px-3 py-1 rounded-full mt-2">Tap the real answer</p>
                </div>

                <div className="flex-1 overflow-y-auto space-y-4 pb-4 px-2 relative z-10">
                    {choices.map((ans, idx) => (
                        <button
                            key={ans.id}
                            onClick={() => { sfx.play('CLICK'); actions.sendVote(ans.id); }}
                            className="w-full p-6 bg-white text-slate-900 rounded-3xl font-black text-xl shadow-lg hover:bg-blue-50 active:scale-95 transition-all text-left relative overflow-hidden uppercase border-b-4 border-slate-300 group"
                            style={{ animationDelay: `${idx * 50}ms` }}
                        >
                            <span className="relative z-10 group-hover:pl-2 transition-all">{ans.text}</span>
                            {/* Show Audience indicators to confuse them */}
                            {ans.audienceVotes.length > 0 && (
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 opacity-80 bg-slate-100 px-3 py-1 rounded-full">
                                    <Users size={16} className="text-indigo-600" />
                                    <span className="text-sm font-bold text-indigo-600">{ans.audienceVotes.length}</span>
                                </div>
                            )}
                        </button>
                    ))}
                </div>

                <div className="relative z-10 w-full max-w-md mx-auto">
                    <EmoteGrid />
                </div>
            </div>
        );
    }

    else {
        content = <div>Loading...</div>;
    }

    return (
        <>
            {content}
            <ConnectionOverlay
                hostDisconnected={hostDisconnected || false}
                roomClosed={roomClosed || false}
                language={state.language}
                roomCode={state.roomCode}
                onHomeClick={onHome}
            />
        </>
    );
};