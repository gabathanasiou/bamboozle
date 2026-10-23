import React from 'react';
import { RefreshCcw, WifiOff } from 'lucide-react';
import { Avatar } from '../components/Avatar';
import { NARRATOR_SEED } from '../constants';
import { GameBackground } from './GameSharedComponents';

export interface OfflineViewProps {
    onRetry: () => void;
}

/** Full-screen offline state, shared by the app shell and the design lab. */
export const OfflineView: React.FC<OfflineViewProps> = ({ onRetry }) => {
    return (
        <GameBackground className="h-screen w-full flex flex-col items-center justify-center p-6 text-center">
            <div className="relative mb-8 transform scale-125">
                <div className="absolute inset-0 bg-red-400 blur-3xl opacity-20 animate-pulse"></div>
                <div className="filter drop-shadow-2xl">
                    <Avatar seed={NARRATOR_SEED} size={150} expression="SHOCKED" />
                </div>
                <div className="absolute -bottom-2 -right-2 bg-red-500 p-3 rounded-full shadow-lg border-2 border-white animate-bounce-slow">
                    <WifiOff className="w-6 h-6 text-white" />
                </div>
            </div>

            <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-gray-400 mb-2 uppercase tracking-tight">
                Bamboozled!
            </h1>
            <p className="text-xl font-bold text-yellow-400 mb-8 uppercase tracking-widest">
                Connection Lost
            </p>

            <p className="text-white/60 mb-10 max-w-xs mx-auto font-medium leading-relaxed">
                Bamboozle is an online multiplayer game and requires an internet connection to play with friends! Please reconnect to continue.
            </p>

            <button
                onClick={onRetry}
                className="group bg-white text-purple-900 px-8 py-4 rounded-2xl font-black uppercase tracking-widest flex items-center gap-3 shadow-2xl hover:bg-yellow-400 hover:scale-105 active:scale-95 transition-all duration-200"
            >
                <RefreshCcw className="w-5 h-5 group-hover:rotate-180 transition-transform duration-500" />
                Retry Connection
            </button>
        </GameBackground>
    );
};
