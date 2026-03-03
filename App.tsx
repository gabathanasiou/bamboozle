import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { useGameService } from './services/gameService';
import { HostView } from './views/HostView';
import { PlayerView } from './views/PlayerView';
import { Monitor, Smartphone, SplitSquareHorizontal, Globe, Settings as SettingsIcon } from 'lucide-react';
import { OnlinePlayerView } from './views/OnlinePlayerView';
import { SettingsView } from './views/SettingsView';
import { AdminView } from './views/AdminView';
import { getText } from './i18n';
import { Avatar } from './components/Avatar';
import { NARRATOR_SEED } from './constants';
import { App as CapApp } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { Expression } from './types';
import { GameBackground, RoomManagerModal } from './views/GameSharedComponents';
import { WifiOff, RefreshCcw } from 'lucide-react';
import { SplashScreen } from '@capacitor/splash-screen';

const App: React.FC = () => {
  const [isOnline, setIsOnline] = useState(true);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // 1. Initial check
    const checkNetwork = async () => {
      const status = await Network.getStatus();
      setIsOnline(status.connected);
    };
    checkNetwork();

    const setupNetwork = async () => {
      const handle = await Network.addListener('networkStatusChange', status => {
        setIsOnline(status.connected);
      });
      return handle;
    };

    const networkPromise = setupNetwork();

    // Handle Android Back Button
    const setupBackButton = async () => {
      const backListener = await CapApp.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack) {
          window.history.back();
        } else {
          if (window.location.pathname === '/') {
            CapApp.exitApp();
          } else {
            window.history.back();
          }
        }
      });
      return backListener;
    };

    const backButtonPromise = setupBackButton();

    // 3. Handle readiness and Splash Screen
    const handleReady = async () => {
      try {
        // Wait for high-priority fonts to be loaded
        if ('fonts' in document) {
          await document.fonts.ready;
        }
        // Give a tiny buffer for layout to settle
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (e) {
        console.error('Ready check failed', e);
      } finally {
        setIsReady(true);
      }
    };
    handleReady();

    return () => {
      networkPromise.then(l => l.remove());
      backButtonPromise.then(l => l.remove());
    };
  }, []);

  useEffect(() => {
    if (isReady) {
      SplashScreen.hide({
        fadeOutDuration: 400
      }).catch(() => {
        // Ignore errors if running on web
      });
    }
  }, [isReady]);

  // Don't render the main app until fonts/network are checked to prevent flashes
  if (!isReady) {
    return null;
  }

  if (!isOnline) {
    return <OfflineView onRetry={async () => {
      const status = await Network.getStatus();
      setIsOnline(status.connected);
    }} />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppContent />} />
        <Route path="/settings" element={<SettingsView />} />
        {import.meta.env.DEV && <Route path="/admin" element={<AdminView />} />}
      </Routes>
    </BrowserRouter>
  );
};

const AppContent: React.FC = () => {
  const [view, setView] = useState<'HOME' | 'HOST' | 'PLAYER' | 'TEST'>('HOME');
  const [targetHostRoomCode, setTargetHostRoomCode] = useState<string | undefined>(undefined);
  const [language, setLanguage] = useState<'en' | 'el'>(() => {
    const stored = localStorage.getItem('bamboozle_language');
    return (stored === 'en' || stored === 'el') ? stored : 'en';
  });

  const handleSetLanguage = (lang: 'en' | 'el') => {
    setLanguage(lang);
    localStorage.setItem('bamboozle_language', lang);
  };

  useEffect(() => {
    document.documentElement.lang = language;
    if (language === 'el') {
      document.body.classList.add('lang-el');
    } else {
      document.body.classList.remove('lang-el');
    }
  }, [language]);

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || (typeof window !== 'undefined' && window.innerWidth <= 768);

  const handleSelectView = (v: 'HOST' | 'PLAYER' | 'TEST', roomCode?: string) => {
    setTargetHostRoomCode(roomCode);
    setView(v);
  };

  return (
    <div className="h-screen w-full overflow-hidden">
      {view === 'HOME' && <HomeSelector onSelect={handleSelectView} isMobile={isMobile} language={language} setLanguage={handleSetLanguage} />}
      {view === 'HOST' && (
        <div className="h-full w-full">
          <GameHostWrapper
            onHome={() => { setView('HOME'); setTargetHostRoomCode(undefined); }}
            debugMode={false}
            language={language}
            setLanguage={handleSetLanguage}
            targetRoomCode={targetHostRoomCode}
          />
        </div>
      )}
      {view === 'PLAYER' && <div className="h-full w-full"><GamePlayerWrapper onHome={() => setView('HOME')} language={language} setLanguage={handleSetLanguage} /></div>}
      {view === 'TEST' && <TestModeView language={language} setLanguage={handleSetLanguage} />}
    </div>
  );
};

const HomeSelector = ({ onSelect, isMobile, language, setLanguage }: { onSelect: (v: 'HOST' | 'PLAYER' | 'TEST', roomCode?: string) => void, isMobile: boolean, language: 'en' | 'el', setLanguage: (l: 'en' | 'el') => void }) => {
  const toggleLanguage = () => setLanguage(language === 'en' ? 'el' : 'en');
  const navigate = useNavigate();

  // Room Management Logic
  const [activeRooms, setActiveRooms] = useState<any[]>([]);
  const [showRoomManager, setShowRoomManager] = useState(false);
  const { actions } = useGameService('PLAYER', { initialLanguage: language }); // Dummy instance for API calls

  const handleHostClick = () => {
    console.log('[Home] Host button clicked. Checking for existing rooms...');

    // Set a safety timeout - if server doesn't respond in 2s, just proceed to Host view
    const safetyTimeout = setTimeout(() => {
      console.warn('[Home] Room check timed out. Proceeding to Host view.');
      onSelect('HOST');
    }, 2000);

    actions.getRoomsByHost!((rooms) => {
      clearTimeout(safetyTimeout);
      console.log('[Home] Received rooms from server:', rooms?.length || 0);
      if (rooms && rooms.length > 0) {
        setActiveRooms(rooms);
        setShowRoomManager(true);
      } else {
        onSelect('HOST');
      }
    });
  };

  // Lively Narrator Logic
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
            <button onClick={handleHostClick} className="group bg-purple-600 hover:bg-purple-500 active:scale-95 active:brightness-90 text-white p-4 rounded-xl flex flex-col items-center shadow-xl transition-all duration-150">
              <div className="bg-white/20 p-3 rounded-full mb-2 group-hover:scale-110 transition-transform">
                <Monitor className="text-white w-6 h-6" />
              </div>
              <h2 className="text-xl font-black mb-0.5 uppercase tracking-wide">{getText(language, 'HOME_HOST_GAME')}</h2>
              <p className="text-[10px] font-bold opacity-80 uppercase tracking-widest">{isMobile ? getText(language, 'HOME_HOST_DESC_MOBILE') : getText(language, 'HOME_HOST_DESC_DESKTOP')}</p>
            </button>

            <button onClick={() => onSelect('PLAYER')} className="group bg-blue-600 hover:bg-blue-500 active:scale-95 active:brightness-90 text-white p-4 rounded-xl flex flex-col items-center shadow-xl transition-all duration-150">
              <div className="bg-white/20 p-3 rounded-full mb-2 group-hover:scale-110 transition-transform">
                <Smartphone className="text-white w-6 h-6" />
              </div>
              <h2 className="text-xl font-black mb-0.5 uppercase tracking-wide">{getText(language, 'HOME_JOIN_GAME')}</h2>
              <p className="text-[10px] font-bold opacity-80 uppercase tracking-widest">{getText(language, 'HOME_JOIN_DESC')}</p>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button onClick={toggleLanguage} className="group bg-pink-600 hover:bg-pink-500 active:scale-95 active:brightness-90 text-white py-3 rounded-xl flex flex-col items-center shadow-xl transition-all duration-150">
              <Globe className="text-pink-200 group-hover:text-white w-5 h-5 mb-1" />
              <h2 className="text-xs font-black uppercase tracking-wide">{language === 'en' ? 'ENGLISH' : 'ΕΛΛΗΝΙΚΑ'}</h2>
            </button>
            <button onClick={() => navigate('/settings')} className="group bg-gray-700 hover:bg-gray-600 active:scale-95 active:brightness-90 text-white py-3 rounded-xl flex flex-col items-center shadow-xl transition-all duration-150">
              <SettingsIcon className="text-gray-300 group-hover:text-white w-5 h-5 mb-1" />
              <h2 className="text-xs font-black uppercase tracking-wide">Settings</h2>
            </button>
          </div>

          {!isMobile && import.meta.env.DEV && (
            <div className="grid grid-cols-1">
              <button onClick={() => onSelect('TEST')} className="group bg-orange-600 hover:bg-orange-500 active:scale-95 active:brightness-90 text-white p-3 rounded-xl flex items-center justify-center gap-3 shadow-xl transition-all duration-150">
                <SplitSquareHorizontal className="text-orange-200 w-5 h-5" />
                <h2 className="text-base font-black uppercase tracking-wide">{getText(language, 'HOME_TEST_MODE')}</h2>
              </button>
            </div>
          )}
        </div>
      </div>

      {showRoomManager && (
        <RoomManagerModal
          rooms={activeRooms}
          language={language}
          onCancel={() => setShowRoomManager(false)}
          onCreateNew={() => { setShowRoomManager(false); onSelect('HOST'); }}
          onRejoin={(code) => { setShowRoomManager(false); onSelect('HOST', code); }}
        />
      )}
    </GameBackground>
  );
};

const TestModeView = ({ language, setLanguage }: { language: 'en' | 'el', setLanguage: (l: 'en' | 'el') => void }) => {
  return (
    <div className="flex flex-col md:flex-row h-full w-full bg-black">
      <div className="flex-1 md:h-full border-b md:border-b-0 md:border-r border-gray-700 relative flex flex-col min-h-0">
        <div className="absolute top-2 left-2 z-50 bg-purple-600 text-white px-2 py-1 rounded text-xs font-bold pointer-events-none shadow-lg">HOST VIEW</div>
        <GameHostWrapper onHome={() => window.location.reload()} debugMode={true} language={language} setLanguage={setLanguage} />
      </div>
      <div className="flex-1 md:h-full md:max-w-sm border-l border-gray-700 relative bg-gray-900 flex flex-col min-h-0">
        <div className="absolute top-2 left-2 z-50 bg-blue-600 text-white px-2 py-1 rounded text-xs font-bold pointer-events-none shadow-lg">PLAYER VIEW</div>
        <GamePlayerWrapper onHome={() => window.location.reload()} language={language} setLanguage={setLanguage} />
      </div>
    </div>
  )
}

const GameHostWrapper = ({ onHome, debugMode, language, setLanguage, targetRoomCode }: { onHome: () => void, debugMode: boolean, language?: 'en' | 'el', setLanguage: (l: 'en' | 'el') => void, targetRoomCode?: string }) => {
  const { state, actions, playerId, isSpeaking, hostDisconnected, roomClosed } = useGameService('HOST', { targetRoomCode, initialLanguage: language });

  useEffect(() => {
    if (state.language && state.language !== language) {
      setLanguage(state.language as 'en' | 'el');
    }
  }, [state.language, language, setLanguage]);

  const shouldForceOnlineMode = true;
  useEffect(() => {
    if (shouldForceOnlineMode && !state.isOnlineMode && state.roomCode) {
      actions.sendToggleOnlineMode();
    }
  }, [state.isOnlineMode, state.roomCode, actions, shouldForceOnlineMode]);

  const [loadingExpression, setLoadingExpression] = useState<Expression>('HAPPY');
  useEffect(() => {
    if (!state.roomCode || (shouldForceOnlineMode && !state.isOnlineMode)) {
      const timer = setInterval(() => {
        const exprs: Expression[] = ['HAPPY', 'SHOCKED', 'THINKING', 'SMUG', 'ANGRY', 'SAD'];
        setLoadingExpression(exprs[Math.floor(Math.random() * exprs.length)]);
      }, 700);
      return () => clearInterval(timer);
    }
  }, [state.roomCode, shouldForceOnlineMode, state.isOnlineMode]);

  if (!state.roomCode || (shouldForceOnlineMode && !state.isOnlineMode)) {
    return (
      <div className="h-full w-full bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 flex flex-col items-center justify-center relative overflow-hidden font-display text-white selection:bg-pink-500">
        <div className="absolute inset-0 z-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
        <div className="relative z-10 flex flex-col items-center translate-y-[-10%]">
          <div className="relative mb-8 transform scale-125 md:scale-150 transition-transform duration-500">
            <div className="absolute inset-0 bg-yellow-400 blur-3xl opacity-20 animate-pulse"></div>
            <div className="filter drop-shadow-2xl animate-bounce" style={{ animationDuration: '3s' }}>
              <Avatar seed={NARRATOR_SEED} size={180} expression={loadingExpression} />
            </div>
          </div>
          <h2 className="text-3xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-200 to-yellow-500 drop-shadow-lg tracking-widest uppercase mb-6 text-center animate-pulse">
            {getText(language || 'en', 'GAME_LOADING')}
          </h2>
          <div className="flex gap-3">
            <div className="w-3 h-3 md:w-4 md:h-4 bg-yellow-400 rounded-full animate-bounce shadow-lg shadow-yellow-400/50" style={{ animationDelay: '0s', animationDuration: '1s' }} />
            <div className="w-3 h-3 md:w-4 md:h-4 bg-yellow-400 rounded-full animate-bounce shadow-lg shadow-yellow-400/50" style={{ animationDelay: '0.15s', animationDuration: '1s' }} />
            <div className="w-3 h-3 md:w-4 md:h-4 bg-yellow-400 rounded-full animate-bounce shadow-lg shadow-yellow-400/50" style={{ animationDelay: '0.3s', animationDuration: '1s' }} />
          </div>
          <p className="mt-6 text-white/40 text-xs md:text-sm font-bold uppercase tracking-[0.2em] text-center">
            {state.roomCode ? 'Setting up...' : 'Connecting...'}
          </p>
        </div>
      </div>
    );
  }

  if (state.isOnlineMode) {
    return <OnlinePlayerView state={state} actions={actions} playerId={playerId} isSpeaking={isSpeaking} onHome={onHome} hostDisconnected={hostDisconnected} roomClosed={roomClosed} />;
  }
  return <HostView state={state} actions={actions} onHome={onHome} debugMode={debugMode} isSpeaking={isSpeaking} />;
};

const GamePlayerWrapper = ({ onHome, language, setLanguage }: { onHome: () => void, language?: 'en' | 'el', setLanguage: (l: 'en' | 'el') => void }) => {
  const { state, actions, playerId, isSpeaking, hostDisconnected, roomClosed } = useGameService('PLAYER', { initialLanguage: language });

  useEffect(() => {
    if (state.language && state.language !== language) {
      setLanguage(state.language as 'en' | 'el');
    }
  }, [state.language, language, setLanguage]);

  if (state.isOnlineMode) {
    return <OnlinePlayerView state={state} actions={actions} playerId={playerId} isSpeaking={isSpeaking} onHome={onHome} hostDisconnected={hostDisconnected} roomClosed={roomClosed} />;
  }
  return <PlayerView state={state} actions={actions} playerId={playerId} hostDisconnected={hostDisconnected} roomClosed={roomClosed} onHome={onHome} />;
};

const OfflineView = ({ onRetry }: { onRetry: () => void }) => {
  return (
    <GameBackground className="h-screen w-full flex flex-col items-center justify-center p-6 text-center">
      <div className="relative mb-8 transform scale-125">
        <div className="absolute inset-0 bg-red-400 blur-3xl opacity-20 animate-pulse"></div>
        <div className="filter drop-shadow-2xl">
          <Avatar seed={NARRATOR_SEED} size={150} expression="SHOCKED" />
        </div>
        <div className="absolute -bottom-2 -right-2 bg-red-500 p-3 rounded-full shadow-lg border-2 border-white animate-bounce">
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

export default App;