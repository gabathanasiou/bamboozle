import React, { useEffect, useState } from 'react';
import { Monitor, Smartphone, SplitSquareHorizontal, Globe, Settings as SettingsIcon } from 'lucide-react';
import { Avatar } from '../components/Avatar';
import { NARRATOR_SEED } from '../constants';
import { getText } from '../i18n';
import { Expression } from '../types';
import { GameBackground } from './GameSharedComponents';

export interface HomeViewProps {
    language: 'en' | 'el';
    isMobile: boolean;
    showTestMode?: boolean;
    onHost: () => void;
    onJoin: () => void;
    onSettings: () => void;
    onToggleLanguage: () => void;
    onTestMode?: () => void;
}

/**
 * Pure home screen, shared by the app shell and the design lab.
 * Keep navigation/room-manager/service concerns in the caller.
 */
export const HomeView: React.FC<HomeViewProps> = ({
    language,
    isMobile,
    showTestMode = false,
    onHost,
    onJoin,
    onSettings,
    onToggleLanguage,
    onTestMode,
}) => {
    const [narratorExpression, setNarratorExpression] = useState<Expression>('HAPPY');

    useEffect(() => {
        const timer = setInterval(() => {
            const exprs: Expression[] = ['HAPPY', 'SMUG', 'THINKING', 'HAPPY', 'HAPPY'];
            setNarratorExpression(exprs[Math.floor(Math.random() * exprs.length)]);
        }, 3000);
        return () => clearInterval(timer);
    }, []);

    return (
        <GameBackground className="flex flex-col items-center justify-center px-5 py-4 md:p-8 overflow-hidden h-[100dvh]">
            <div className="relative z-10 w-full max-w-md md:max-w-5xl flex flex-col items-center h-full min-h-0 justify-center gap-0">
                <div className="relative mb-2 md:mb-4 transform hover:scale-105 transition-transform duration-300 cursor-pointer" onClick={() => setNarratorExpression('SHOCKED')}>
                    <div className="absolute inset-0 bg-yellow-400 blur-3xl opacity-20 animate-pulse"></div>
                    <div className="filter drop-shadow-lg animate-float">
                        <Avatar seed={NARRATOR_SEED} size={120} expression={narratorExpression} className="!w-24 !h-24 md:!w-32 md:!h-32" />
                    </div>
                </div>

                <h1 className="text-4xl md:text-5xl lg:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-b from-yellow-300 to-yellow-600 mb-1 drop-shadow-xl tracking-tighter uppercase transform -rotate-2 text-center">
                    Bamboozle
                </h1>

                <p className="mb-6 text-white/50 text-xs font-bold uppercase tracking-[0.2em] text-center">
                    {getText(language, 'HOME_TAGLINE')}
                </p>

                <div className="w-full space-y-3 relative z-20">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                        <button onClick={onHost} className="group bg-purple-600 hover:bg-purple-500 active:scale-95 active:brightness-90 text-white p-4 rounded-xl flex flex-col items-center shadow-xl transition-all duration-150">
                            <div className="bg-white/20 p-3 rounded-full mb-2 group-hover:scale-110 transition-transform">
                                <Monitor className="text-white w-6 h-6" />
                            </div>
                            <h2 className="text-xl font-black mb-0.5 uppercase tracking-wide">{getText(language, 'HOME_HOST_GAME')}</h2>
                            <p className="text-[10px] font-bold opacity-80 uppercase tracking-widest">{isMobile ? getText(language, 'HOME_HOST_DESC_MOBILE') : getText(language, 'HOME_HOST_DESC_DESKTOP')}</p>
                        </button>

                        <button onClick={onJoin} className="group bg-blue-600 hover:bg-blue-500 active:scale-95 active:brightness-90 text-white p-4 rounded-xl flex flex-col items-center shadow-xl transition-all duration-150">
                            <div className="bg-white/20 p-3 rounded-full mb-2 group-hover:scale-110 transition-transform">
                                <Smartphone className="text-white w-6 h-6" />
                            </div>
                            <h2 className="text-xl font-black mb-0.5 uppercase tracking-wide">{getText(language, 'HOME_JOIN_GAME')}</h2>
                            <p className="text-[10px] font-bold opacity-80 uppercase tracking-widest">{getText(language, 'HOME_JOIN_DESC')}</p>
                        </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <button onClick={onToggleLanguage} className="group bg-pink-600 hover:bg-pink-500 active:scale-95 active:brightness-90 text-white py-3 rounded-xl flex flex-col items-center shadow-xl transition-all duration-150">
                            <Globe className="text-pink-200 group-hover:text-white w-5 h-5 mb-1" />
                            <h2 className="text-xs font-black uppercase tracking-wide">{language === 'en' ? 'ENGLISH' : 'ΕΛΛΗΝΙΚΑ'}</h2>
                        </button>
                        <button onClick={onSettings} className="group bg-gray-700 hover:bg-gray-600 active:scale-95 active:brightness-90 text-white py-3 rounded-xl flex flex-col items-center shadow-xl transition-all duration-150">
                            <SettingsIcon className="text-gray-300 group-hover:text-white w-5 h-5 mb-1" />
                            <h2 className="text-xs font-black uppercase tracking-wide">Settings</h2>
                        </button>
                    </div>

                    {showTestMode && (
                        <div className="grid grid-cols-1">
                            <button onClick={onTestMode} className="group bg-orange-600 hover:bg-orange-500 active:scale-95 active:brightness-90 text-white p-3 rounded-xl flex items-center justify-center gap-3 shadow-xl transition-all duration-150">
                                <SplitSquareHorizontal className="text-orange-200 w-5 h-5" />
                                <h2 className="text-base font-black uppercase tracking-wide">{getText(language, 'HOME_TEST_MODE')}</h2>
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </GameBackground>
    );
};
