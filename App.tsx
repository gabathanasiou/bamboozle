import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { useGameService } from './services/gameService';
import { HostView } from './views/HostView';
import { PlayerView } from './views/PlayerView';
import { OnlinePlayerView } from './views/OnlinePlayerView';
import { SettingsView } from './views/SettingsView';
import { AdminView } from './views/AdminView';
import { HomeView } from './views/HomeView';
import { OfflineView } from './views/OfflineView';
import { getText } from './i18n';
import { Avatar } from './components/Avatar';
import { NARRATOR_SEED } from './constants';
import { App as CapApp } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { Expression } from './types';
import { RoomManagerModal } from './views/GameSharedComponents';
import { SplashScreen } from '@capacitor/splash-screen';

const designerEnabled = import.meta.env.DEV || import.meta.env.VITE_DESIGNER === '1';
const DesignerView = React.lazy(() => import('./designer/DesignerView').then((module) => ({ default: module.DesignerView })));
const PreviewSurface = React.lazy(() => import('./designer/PreviewSurface').then((module) => ({ default: module.PreviewSurface })));
const DesignerFallback = () => <div className="h-screen w-full bg-[#0b0f19]" />;

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
        {designerEnabled && (
          <>
            <Route path="/designer" element={<React.Suspense fallback={<DesignerFallback />}><DesignerView /></React.Suspense>} />
            <Route path="/designer/preview" element={<React.Suspense fallback={<DesignerFallback />}><PreviewSurface /></React.Suspense>} />
          </>
        )}
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
      {view === 'HOME' && <HomeScreen onSelect={handleSelectView} isMobile={isMobile} language={language} setLanguage={handleSetLanguage} />}
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

const HomeScreen = ({ onSelect, isMobile, language, setLanguage }: { onSelect: (v: 'HOST' | 'PLAYER' | 'TEST', roomCode?: string) => void, isMobile: boolean, language: 'en' | 'el', setLanguage: (l: 'en' | 'el') => void }) => {
  const navigate = useNavigate();

  // Room Management Logic
  const [activeRooms, setActiveRooms] = useState<any[]>([]);
  const [showRoomManager, setShowRoomManager] = useState(false);
  const { actions } = useGameService('PLAYER', { initialLanguage: language }); // Dummy instance for API calls

  const handleHostClick = () => {
    import.meta.env.DEV && console.log('[Home] Host button clicked. Checking for existing rooms...');

    // Set a safety timeout - if server doesn't respond in 2s, just proceed to Host view
    const safetyTimeout = setTimeout(() => {
      import.meta.env.DEV && console.warn('[Home] Room check timed out. Proceeding to Host view.');
      onSelect('HOST');
    }, 2000);

    actions.getRoomsByHost!((rooms) => {
      clearTimeout(safetyTimeout);
      import.meta.env.DEV && console.log('[Home] Received rooms from server:', rooms?.length || 0);
      if (rooms && rooms.length > 0) {
        setActiveRooms(rooms);
        setShowRoomManager(true);
      } else {
        onSelect('HOST');
      }
    });
  };

  return (
    <>
      <HomeView
        language={language}
        isMobile={isMobile}
        showTestMode={!isMobile && import.meta.env.DEV}
        onHost={handleHostClick}
        onJoin={() => onSelect('PLAYER')}
        onSettings={() => navigate('/settings')}
        onToggleLanguage={() => setLanguage(language === 'en' ? 'el' : 'en')}
        onTestMode={() => onSelect('TEST')}
      />

      {import.meta.env.DEV && !isMobile && (
        <button
          onClick={() => navigate('/designer')}
          className="fixed bottom-3 right-3 z-50 rounded-lg border border-yellow-400/40 bg-black/70 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-yellow-300 shadow-lg backdrop-blur hover:bg-black/90"
          title="Open the design lab"
        >
          Design Lab
        </button>
      )}

      {showRoomManager && (
        <RoomManagerModal
          rooms={activeRooms}
          language={language}
          onCancel={() => setShowRoomManager(false)}
          onCreateNew={() => { setShowRoomManager(false); onSelect('HOST'); }}
          onRejoin={(code) => { setShowRoomManager(false); onSelect('HOST', code); }}
        />
      )}
    </>
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
            <div className="filter drop-shadow-2xl animate-bounce-slow">
              <Avatar seed={NARRATOR_SEED} size={180} expression={loadingExpression} />
            </div>
          </div>
          <h2 className="text-3xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-200 to-yellow-500 drop-shadow-lg tracking-widest uppercase mb-6 text-center animate-pulse">
            {getText(language || 'en', 'GAME_LOADING')}
          </h2>
          <div className="flex gap-3">
            <div className="w-3 h-3 md:w-4 md:h-4 bg-yellow-400 rounded-full animate-bounce-slow shadow-lg shadow-yellow-400/50" style={{ animationDelay: '0s' }} />
            <div className="w-3 h-3 md:w-4 md:h-4 bg-yellow-400 rounded-full animate-bounce-slow shadow-lg shadow-yellow-400/50" style={{ animationDelay: '0.15s' }} />
            <div className="w-3 h-3 md:w-4 md:h-4 bg-yellow-400 rounded-full animate-bounce-slow shadow-lg shadow-yellow-400/50" style={{ animationDelay: '0.3s' }} />
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

export default App;