import React, { useState, useRef, useMemo, useEffect } from 'react';
import { toPng } from 'html-to-image';
import { Download, LayoutGrid, User, Image, RefreshCw, Layers, Check, ChevronRight, Monitor, Smartphone } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { NARRATOR_SEED } from '@/constants';
import { Expression } from '@/types';

// Constants for assets
const ASSET_TYPES = [
    { id: 'icon', label: 'App Icon', icon: Smartphone },
    { id: 'loading', label: 'Loading Screen', icon: LayoutGrid },
    { id: 'store', label: 'Store Banner', icon: Image },
];

const EXPRESSIONS: Expression[] = ['NEUTRAL', 'HAPPY', 'SHOCKED', 'THINKING', 'SMUG', 'SAD', 'ANGRY'];

export const AssetGenerator: React.FC = () => {
    const [activeTab, setActiveTab] = useState('icon');

    // Icon State
    const [iconSettings, setIconSettings] = useState({
        expression: 'HAPPY' as Expression,
        showTitle: true,
        bgGradient: 'from-indigo-500 to-purple-600',
        padding: 60,
        size: 512,
        borderRadius: 100, // For preview
    });

    // Loading Screen State
    const [loadingSettings, setLoadingSettings] = useState({
        avatarSize: 80,
        columns: 8,
        rows: 12,
        bgGradient: 'from-slate-900 to-slate-800',
        seed: 'initial-seed',
    });

    // Store Banner State
    const [storeSettings, setStoreSettings] = useState({
        expression: 'HAPPY' as Expression,
        showTitle: true,
        bgGradient: 'from-blue-600 via-indigo-600 to-purple-800',
        width: 1920,
        height: 1080,
        avatarCount: 15,
        seed: 'store-seed',
    });

    const exportRef = useRef<HTMLDivElement>(null);

    const handleDownload = async () => {
        if (exportRef.current) {
            const dataUrl = await toPng(exportRef.current, {
                quality: 0.95,
                pixelRatio: 2, // High DPI for better quality
                cacheBust: true,
            });
            const link = document.createElement('a');
            link.download = `bamboozle-${activeTab}-${Date.now()}.png`;
            link.href = dataUrl;
            link.click();
        }
    };

    return (
        <div className="flex h-screen bg-[#0f172a] text-slate-100 antialiased overflow-hidden">
            {/* Sidebar Navigation */}
            <aside className="w-72 bg-slate-900/50 border-r border-slate-800 flex flex-col p-6 backdrop-blur-xl">
                <div className="flex items-center space-x-3 mb-10 px-2 transition-transform hover:scale-105">
                    <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20 ring-1 ring-white/10">
                        <Layers className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h1 className="text-xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-br from-white to-slate-400">
                            Asset Core
                        </h1>
                        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Bamboozle Engine</p>
                    </div>
                </div>

                <nav className="space-y-2 mb-auto">
                    {ASSET_TYPES.map((type) => (
                        <button
                            key={type.id}
                            onClick={() => setActiveTab(type.id)}
                            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-300 group ${activeTab === type.id
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 ring-1 ring-white/10 translate-x-1'
                                : 'text-slate-400 hover:bg-slate-800/80 hover:text-white'
                                }`}
                        >
                            <type.icon className={`w-5 h-5 transition-transform duration-300 ${activeTab === type.id ? 'scale-110' : 'group-hover:scale-110'}`} />
                            <span className="font-semibold">{type.label}</span>
                            {activeTab === type.id && <ChevronRight className="w-4 h-4 ml-auto opacity-50" />}
                        </button>
                    ))}
                </nav>

                <div className="pt-6 border-t border-slate-800/50">
                    <button
                        onClick={handleDownload}
                        className="w-full flex items-center justify-center space-x-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white py-3.5 rounded-xl font-bold shadow-xl shadow-emerald-500/20 transition-all active:scale-[0.98] ring-1 ring-white/10"
                    >
                        <Download className="w-5 h-5 animate-bounce-subtle" />
                        <span>Export Assets</span>
                    </button>
                </div>
            </aside>

            {/* Main Area */}
            <main className="flex-1 flex overflow-hidden">
                {/* Preview Viewport */}
                <div className="flex-1 bg-slate-950 p-12 overflow-auto flex items-center justify-center pattern-grid">
                    <div className="relative group">
                        <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-[32px] blur-2xl opacity-20 group-hover:opacity-30 transition-opacity"></div>
                        <div
                            ref={exportRef}
                            className="relative shadow-2xl overflow-hidden bg-slate-900 border border-white/5"
                            style={{
                                width: activeTab === 'icon' ? iconSettings.size : (activeTab === 'loading' ? 400 : 960),
                                height: activeTab === 'icon' ? iconSettings.size : (activeTab === 'loading' ? 700 : 540),
                                transform: activeTab === 'icon' ? 'none' : 'scale(1)',
                            }}
                        >
                            {activeTab === 'icon' && (
                                <IconAsset settings={iconSettings} />
                            )}
                            {activeTab === 'loading' && (
                                <LoadingAsset settings={loadingSettings} />
                            )}
                            {activeTab === 'store' && (
                                <StoreAsset settings={storeSettings} />
                            )}
                        </div>
                    </div>
                </div>

                {/* Properties Inspector */}
                <aside className="w-96 bg-slate-900/80 border-l border-slate-800 backdrop-blur-2xl p-8 overflow-y-auto custom-scrollbar">
                    <div className="flex items-center space-x-2 mb-8 border-b border-slate-800/50 pb-4">
                        <Monitor className="w-5 h-5 text-indigo-400" />
                        <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400 px-1">Inspector</h2>
                    </div>

                    {activeTab === 'icon' && (
                        <IconControls settings={iconSettings} setSettings={setIconSettings} />
                    )}
                    {activeTab === 'loading' && (
                        <LoadingControls settings={loadingSettings} setSettings={setLoadingSettings} />
                    )}
                    {activeTab === 'store' && (
                        <StoreControls settings={storeSettings} setSettings={setStoreSettings} />
                    )}
                </aside>
            </main>

            <style>{`
                .pattern-grid {
                    background-image: radial-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px);
                    background-size: 30px 30px;
                }
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: #1e293b;
                    border-radius: 10px;
                }
                @keyframes bounce-subtle {
                    from { transform: translateY(0); }
                    to { transform: translateY(-3px); }
                }
                .animate-bounce-subtle {
                    animation: bounce-subtle 1s infinite alternate ease-in-out;
                }
            `}</style>
        </div>
    );
};

// --- PREVIEW COMPONENTS ---

const IconAsset: React.FC<{ settings: any }> = ({ settings }) => {
    return (
        <div className={`w-full h-full flex flex-col items-center justify-center bg-gradient-to-br ${settings.bgGradient}`}>
            <div style={{ width: '60%', height: '60%', filter: 'drop-shadow(0 25px 35px rgba(0,0,0,0.3))' }}>
                <Avatar
                    seed={NARRATOR_SEED}
                    size={settings.size * 0.6}
                    expression={settings.expression}
                    className="w-full h-full"
                />
            </div>
            {settings.showTitle && (
                <h1 className="mt-8 text-[4.5rem] font-[800] tracking-tighter text-white drop-shadow-[0_4px_12px_rgba(0,0,0,0.4)] px-4 text-center leading-[0.9]">
                    BAMBOOZLE
                </h1>
            )}
        </div>
    );
};

const LoadingAsset: React.FC<{ settings: any }> = ({ settings }) => {
    const columns = useMemo(() => {
        const cols = [];
        for (let c = 0; c < settings.columns; c++) {
            const column = [];
            for (let r = 0; r < settings.rows; r++) {
                column.push(`${settings.seed}-${c}-${r}`);
            }
            cols.push(column);
        }
        return cols;
    }, [settings.rows, settings.columns, settings.seed]);

    return (
        <div className={`w-full h-full bg-gradient-to-br ${settings.bgGradient} overflow-hidden flex items-start justify-center p-8`}>
            {columns.map((column, c) => (
                <div
                    key={c}
                    className="flex flex-col space-y-4"
                    style={{
                        marginLeft: c === 0 ? 0 : -(settings.avatarSize / 4),
                        marginTop: c % 2 === 0 ? 0 : settings.avatarSize / 2
                    }}
                >
                    {column.map((seed, r) => (
                        <div key={r} style={{ width: settings.avatarSize, height: settings.avatarSize }} className="filter drop-shadow-xl opacity-90 hover:opacity-100 transition-opacity">
                            <Avatar seed={seed} size={settings.avatarSize} expression="HAPPY" />
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
};

const StoreAsset: React.FC<{ settings: any }> = ({ settings }) => {
    const randomAvatars = useMemo(() => {
        return Array.from({ length: settings.avatarCount }).map((_, i) => ({
            seed: `${settings.seed}-avatar-${i}`,
            x: Math.random() * 100,
            y: Math.random() * 100,
            size: 60 + Math.random() * 100,
            rotation: (Math.random() - 0.5) * 40,
        }));
    }, [settings.avatarCount, settings.seed]);

    return (
        <div className={`w-full h-full bg-gradient-to-br ${settings.bgGradient} relative overflow-hidden flex items-center justify-center`}>
            {/* Background floating avatars */}
            {randomAvatars.map((av, i) => (
                <div
                    key={i}
                    className="absolute opacity-30 blur-[1px]"
                    style={{
                        left: `${av.x}%`,
                        top: `${av.y}%`,
                        width: av.size,
                        height: av.size,
                        transform: `rotate(${av.rotation}deg)`
                    }}
                >
                    <Avatar seed={av.seed} size={av.size} expression="HAPPY" />
                </div>
            ))}

            {/* Foreground elements */}
            <div className="relative z-10 flex flex-col items-center space-y-8 bg-black/10 backdrop-blur-sm p-16 rounded-[4rem] border border-white/5 shadow-2xl">
                <div className="flex items-center space-x-12">
                    <Avatar
                        seed={NARRATOR_SEED}
                        size={280}
                        expression={settings.expression}
                        className="filter drop-shadow-[0_25px_45px_rgba(0,0,0,0.5)] scale-110"
                    />
                    {settings.showTitle && (
                        <div className="flex flex-col">
                            <h1 className="text-9xl font-extrabold tracking-tighter text-white drop-shadow-[0_8px_24px_rgba(0,0,0,0.6)]">
                                BAMBOOZLE
                            </h1>
                            <p className="text-4xl text-indigo-200/80 font-semibold tracking-wide ml-2 uppercase">The Ultimate Party Game</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// --- CONTROL COMPONENTS ---

const ControlGroup: React.FC<{ label: string, children: React.ReactNode }> = ({ label, children }) => (
    <div className="mb-8 p-1 group">
        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-5 px-1 group-hover:text-indigo-400 transition-colors">
            {label}
        </label>
        <div className="space-y-4">
            {children}
        </div>
    </div>
);

const ColorOption: React.FC<{ value: string, active: boolean, onClick: () => void }> = ({ value, active, onClick }) => (
    <button
        onClick={onClick}
        className={`w-10 h-10 rounded-full bg-gradient-to-br ${value} border-2 transition-all p-1 active:scale-90 ${active ? 'border-white scale-125 shadow-lg shadow-white/10' : 'border-transparent opacity-60 hover:opacity-100 hover:scale-110'}`}
    />
);

const IconControls: React.FC<{ settings: any, setSettings: (val: any) => void }> = ({ settings, setSettings }) => {
    const gradients = [
        'from-indigo-500 to-purple-600',
        'from-blue-500 to-teal-500',
        'from-rose-500 to-orange-500',
        'from-slate-700 to-slate-900',
        'from-emerald-500 to-cyan-500',
        'from-amber-400 to-pink-500',
        'from-violet-600 to-indigo-800'
    ];

    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-500">
            <ControlGroup label="Expression">
                <div className="grid grid-cols-4 gap-2">
                    {EXPRESSIONS.map((exp) => (
                        <button
                            key={exp}
                            onClick={() => setSettings({ ...settings, expression: exp })}
                            className={`p-2 rounded-xl text-[10px] font-bold transition-all border ${settings.expression === exp
                                ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300 shadow-inner shadow-indigo-500/10'
                                : 'bg-slate-800/40 border-slate-700/50 text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
                                }`}
                        >
                            {exp}
                        </button>
                    ))}
                </div>
            </ControlGroup>

            <ControlGroup label="Title Visibility">
                <button
                    onClick={() => setSettings({ ...settings, showTitle: !settings.showTitle })}
                    className={`w-full py-4 rounded-2xl flex items-center justify-center space-x-3 transition-all border ${settings.showTitle
                        ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                        : 'bg-slate-800/40 border-slate-700 text-slate-400 grayscale'
                        }`}
                >
                    <Check className={`w-5 h-5 transition-transform ${settings.showTitle ? 'scale-110' : 'scale-75 opacity-0'}`} />
                    <span className="font-bold tracking-tight">Show App Title</span>
                </button>
            </ControlGroup>

            <ControlGroup label="Background Gradient">
                <div className="flex flex-wrap gap-4 px-2">
                    {gradients.map((grad) => (
                        <ColorOption
                            key={grad}
                            value={grad}
                            active={settings.bgGradient === grad}
                            onClick={() => setSettings({ ...settings, bgGradient: grad })}
                        />
                    ))}
                </div>
            </ControlGroup>
        </div>
    );
};

const LoadingControls: React.FC<{ settings: any, setSettings: (val: any) => void }> = ({ settings, setSettings }) => (
    <div className="animate-in fade-in slide-in-from-right-4 duration-500">
        <ControlGroup label="Canvas Grid">
            <div className="space-y-6">
                <div>
                    <div className="flex justify-between text-[11px] font-bold text-slate-400 mb-2 uppercase tracking-tighter px-1">
                        <span>Columns</span>
                        <span className="text-indigo-400 font-black">{settings.columns}</span>
                    </div>
                    <input
                        type="range" min="4" max="15" value={settings.columns}
                        onChange={(e) => setSettings({ ...settings, columns: parseInt(e.target.value) })}
                        className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-full appearance-none cursor-pointer"
                    />
                </div>
                <div>
                    <div className="flex justify-between text-[11px] font-bold text-slate-400 mb-2 uppercase tracking-tighter px-1">
                        <span>Rows</span>
                        <span className="text-indigo-400 font-black">{settings.rows}</span>
                    </div>
                    <input
                        type="range" min="4" max="25" value={settings.rows}
                        onChange={(e) => setSettings({ ...settings, rows: parseInt(e.target.value) })}
                        className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-full appearance-none cursor-pointer"
                    />
                </div>
                <div>
                    <div className="flex justify-between text-[11px] font-bold text-slate-400 mb-2 uppercase tracking-tighter px-1">
                        <span>Avatar Size</span>
                        <span className="text-indigo-400 font-black">{settings.avatarSize}px</span>
                    </div>
                    <input
                        type="range" min="40" max="120" value={settings.avatarSize}
                        onChange={(e) => setSettings({ ...settings, avatarSize: parseInt(e.target.value) })}
                        className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-full appearance-none cursor-pointer"
                    />
                </div>
            </div>
        </ControlGroup>

        <ControlGroup label="Population">
            <button
                onClick={() => setSettings({ ...settings, seed: Math.random().toString(36) })}
                className="w-full py-4 bg-slate-800/60 border border-indigo-500/30 hover:bg-slate-800 hover:border-indigo-500/60 text-indigo-300 rounded-2xl flex items-center justify-center space-x-3 transition-all font-bold shadow-lg active:scale-95"
            >
                <RefreshCw className="w-5 h-5" />
                <span>Shuffle Avatars</span>
            </button>
        </ControlGroup>
    </div>
);

const StoreControls: React.FC<{ settings: any, setSettings: (val: any) => void }> = ({ settings, setSettings }) => {
    const gradients = [
        'from-blue-600 via-indigo-600 to-purple-800',
        'from-rose-600 via-pink-600 to-purple-800',
        'from-emerald-600 via-teal-600 to-blue-800',
        'from-amber-600 via-orange-600 to-rose-800'
    ];

    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-500">
            <ControlGroup label="Narrator Mood">
                <div className="grid grid-cols-4 gap-2">
                    {EXPRESSIONS.map((exp) => (
                        <button
                            key={exp}
                            onClick={() => setSettings({ ...settings, expression: exp })}
                            className={`p-2 rounded-xl text-[10px] font-bold transition-all border ${settings.expression === exp
                                ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'
                                : 'bg-slate-800/40 border-slate-700/50 text-slate-400'
                                }`}
                        >
                            {exp}
                        </button>
                    ))}
                </div>
            </ControlGroup>

            <ControlGroup label="Crowd Density">
                <div>
                    <div className="flex justify-between text-[11px] font-bold text-slate-400 mb-2 uppercase tracking-tighter px-1">
                        <span>Background Avatars</span>
                        <span className="text-indigo-400 font-black">{settings.avatarCount}</span>
                    </div>
                    <input
                        type="range" min="5" max="50" value={settings.avatarCount}
                        onChange={(e) => setSettings({ ...settings, avatarCount: parseInt(e.target.value) })}
                        className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-full appearance-none cursor-pointer"
                    />
                </div>
                <button
                    onClick={() => setSettings({ ...settings, seed: Math.random().toString(36) })}
                    className="w-full mt-6 py-4 bg-slate-800/60 border border-slate-700 hover:bg-slate-800 text-slate-300 rounded-2xl flex items-center justify-center space-x-3 transition-all font-bold"
                >
                    <RefreshCw className="w-4 h-4" />
                    <span>Regenerate Layout</span>
                </button>
            </ControlGroup>

            <ControlGroup label="Theme Palette">
                <div className="flex flex-wrap gap-4 px-2">
                    {gradients.map((grad) => (
                        <ColorOption
                            key={grad}
                            value={grad}
                            active={settings.bgGradient === grad}
                            onClick={() => setSettings({ ...settings, bgGradient: grad })}
                        />
                    ))}
                </div>
            </ControlGroup>
        </div>
    );
};
