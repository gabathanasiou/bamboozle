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

// Default settings for snapping and initialization
const DEFAULTS = {
    icon: {
        expression: 'HAPPY' as Expression,
        randomExpressions: false,
        showTitle: true,
        bgStyle: 'game' as 'game' | 'gradient' | 'solid',
        bgColor: '#4f46e5',
        bgGradient: 'from-indigo-500 to-purple-600',
        padding: 60,
        size: 512,
        bgTint: 0,
        narratorSize: 60,
    },
    loading: {
        avatarSize: 80,
        columns: 8,
        rows: 12,
        spacing: 12,
        bgStyle: 'game' as 'game' | 'gradient' | 'solid',
        bgColor: '#0f172a',
        bgGradient: 'from-slate-900 to-slate-800',
        randomExpressions: true,
        expression: 'HAPPY' as Expression,
        bgTint: 0,
    },
    store: {
        expression: 'HAPPY' as Expression,
        randomExpressions: true,
        showTitle: true,
        bgStyle: 'game' as 'game' | 'gradient' | 'solid',
        bgColor: '#1e1b4b',
        bgGradient: 'from-blue-600 via-indigo-600 to-purple-800',
        avatarCount: 15,
        bgTint: 0,
    }
};

const getExpression = (seed: string, settings: any) => {
    if (!settings.randomExpressions) return settings.expression;

    // DJB2 hash for better distribution than standard additive hash
    let hash = 5381;
    for (let i = 0; i < seed.length; i++) {
        hash = (hash * 33) ^ seed.charCodeAt(i);
    }

    // XOR with a secondary shift to increase entropy for small index ranges
    const finalHash = Math.abs(hash ^ (hash >> 16));
    return EXPRESSIONS[finalHash % EXPRESSIONS.length];
};

const BaseBackground: React.FC<{ settings: any, children: React.ReactNode, className?: string }> = ({ settings, children, className = "" }) => {
    const bgClass = useMemo(() => {
        if (settings.bgStyle === 'game') return 'bg-linear-to-br from-indigo-900 via-purple-900 to-pink-900';
        if (settings.bgStyle === 'gradient') return `bg-linear-to-br ${settings.bgGradient}`;
        return '';
    }, [settings.bgStyle, settings.bgGradient]);

    const bgStyleCurrent = useMemo(() => {
        const style: any = {};
        if (settings.bgStyle === 'solid') style.backgroundColor = settings.bgColor;
        if (settings.bgStyle === 'game' && settings.bgTint) style.filter = `hue-rotate(${settings.bgTint}deg)`;
        return style;
    }, [settings.bgStyle, settings.bgColor, settings.bgTint]);

    return (
        <div className={`w-full h-full relative overflow-hidden flex items-center justify-center ${className}`}>
            {/* Background Layer (affected by tint) */}
            <div className={`absolute inset-0 ${bgClass}`} style={bgStyleCurrent}>
                {settings.bgStyle === 'game' && (
                    <div className="absolute inset-0 z-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
                )}
            </div>
            <div className="relative z-10 w-full h-full flex items-center justify-center">
                {children}
            </div>
        </div>
    );
};

export const AssetGenerator: React.FC = () => {
    const [activeTab, setActiveTab] = useState('icon');
    // Global Export Scale
    const [exportScale, setExportScale] = useState(4); // Default to 4x (4K ready)

    // Icon State
    const [iconSettings, setIconSettings] = useState({
        ...DEFAULTS.icon,
        borderRadius: 100, // For preview
    });

    // Loading Screen State
    const [loadingSettings, setLoadingSettings] = useState({
        ...DEFAULTS.loading,
        seed: 'initial-seed',
        preset: 'phone' as 'phone' | 'tablet',
    });

    // Store Banner State
    const [storeSettings, setStoreSettings] = useState({
        ...DEFAULTS.store,
        width: 1920,
        height: 1080,
        seed: 'store-seed',
    });

    const exportRef = useRef<HTMLDivElement>(null);

    const handleDownload = async () => {
        if (exportRef.current) {
            const dataUrl = await toPng(exportRef.current, {
                quality: 0.95,
                pixelRatio: exportScale, // Dynamic scale for high resolution
                cacheBust: true,
            });
            const link = document.createElement('a');

            // Standard naming for @capacitor/assets compatibility
            let filename = `bamboozle-${activeTab}.png`;
            if (activeTab === 'icon') filename = 'icon.png';
            if (activeTab === 'loading') filename = 'splash.png';
            if (activeTab === 'store') filename = `store-banner-${Date.now()}.png`;

            link.download = filename;
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

                <nav className="space-y-2 mb-8">
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

                <div className="space-y-4 mb-4">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 px-2">Export Quality</label>
                    <div className="grid grid-cols-3 gap-2 p-1 bg-slate-800/50 rounded-xl border border-slate-700/50">
                        {[2, 4, 8].map((scale) => (
                            <button
                                key={scale}
                                onClick={() => setExportScale(scale)}
                                className={`py-2 text-[10px] font-black rounded-lg transition-all ${exportScale === scale ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
                            >
                                {scale}X
                            </button>
                        ))}
                    </div>
                </div>

                <div className="pt-6 border-t border-slate-800/50 mt-auto">
                    <button
                        onClick={handleDownload}
                        className="w-full flex items-center justify-center space-x-2 bg-linear-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white py-3.5 rounded-xl font-bold shadow-xl shadow-emerald-500/20 transition-all active:scale-[0.98] ring-1 ring-white/10"
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
                        <div className="absolute -inset-1 bg-linear-to-r from-indigo-500 to-purple-600 rounded-2xl blur-2xl opacity-20 group-hover:opacity-30 transition-opacity"></div>
                        <div
                            ref={exportRef}
                            className="relative shadow-2xl overflow-hidden border border-white/5 bg-slate-950"
                            style={{
                                width: activeTab === 'icon' ? iconSettings.size : (activeTab === 'loading' ? (loadingSettings.preset === 'tablet' ? 525 : 400) : 960),
                                height: activeTab === 'icon' ? iconSettings.size : (activeTab === 'loading' ? (loadingSettings.preset === 'tablet' ? 700 : 700) : 540),
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
        <BaseBackground settings={settings} className="flex-col">
            <div style={{ width: `${settings.narratorSize}%`, height: `${settings.narratorSize}%`, filter: 'drop-shadow(0 25px 35px rgba(0,0,0,0.3))' }}>
                <Avatar
                    seed={NARRATOR_SEED}
                    size={settings.size * (settings.narratorSize / 100)}
                    expression={settings.expression}
                    className="w-full h-full"
                />
            </div>
            {settings.showTitle && (
                <h1 className="mt-8 text-[4.5rem] font-extrabold tracking-tighter text-white drop-shadow-[0_4px_12px_rgba(0,0,0,0.4)] px-4 text-center leading-[0.9]">
                    BAMBOOZLE
                </h1>
            )}
        </BaseBackground>
    );
};

const LoadingAsset: React.FC<{ settings: any }> = ({ settings }) => {
    const columns = useMemo(() => {
        const cols = [];
        for (let c = 0; c < settings.columns; c++) {
            const column = [];
            for (let r = 0; r < settings.rows; r++) {
                // Mix in more randomness for the seed to ensure columns look distinct
                // Using a salt that changes significantly per column
                const colSalt = c * 727;
                const rowSalt = r * 133;
                column.push(`${settings.seed}-c${colSalt}-r${rowSalt}`);
            }
            cols.push(column);
        }
        return cols;
    }, [settings.rows, settings.columns, settings.seed]);

    return (
        <BaseBackground settings={settings} className="p-8 items-start!">
            {columns.map((column, c) => (
                <div
                    key={c}
                    className="flex flex-col"
                    style={{
                        marginLeft: c === 0 ? 0 : settings.spacing,
                        marginTop: -settings.avatarSize + (c % 2 === 0 ? 0 : (settings.avatarSize + settings.spacing) / 2)
                    }}
                >
                    {column.map((seed, r) => (
                        <div key={r} style={{ width: settings.avatarSize, height: settings.avatarSize, marginBottom: settings.spacing }} className="filter drop-shadow-xl opacity-90 hover:opacity-100 transition-opacity">
                            <Avatar seed={seed} size={settings.avatarSize} expression={getExpression(seed, settings)} />
                        </div>
                    ))}
                </div>
            ))}
        </BaseBackground>
    );
};

const StoreAsset: React.FC<{ settings: any }> = ({ settings }) => {
    const randomAvatars = useMemo(() => {
        const avatars: any[] = [];
        const maxAttempts = 150;
        const bannerWidth = 960;
        const bannerHeight = 540;

        for (let i = 0; i < settings.avatarCount; i++) {
            let placed = false;
            let attempts = 0;

            while (!placed && attempts < maxAttempts) {
                const size = 60 + Math.random() * 100;
                const x = Math.random() * 100;
                const y = Math.random() * 100;

                // Check for overlap with existing avatars
                const hasOverlap = avatars.some(av => {
                    const dx = (x - av.x) * (bannerWidth / 100);
                    const dy = (y - av.y) * (bannerHeight / 100);
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    return distance < (size / 2 + av.size / 2 + 30); // 30px padding
                });

                // Check for overlap with central hero area
                const distToCenter = Math.sqrt(Math.pow(x - 50, 2) + Math.pow(y - 50 * (bannerWidth / bannerHeight), 2));
                const isTooCentral = x > 30 && x < 70 && y > 30 && y < 70;

                if (!hasOverlap && !isTooCentral) {
                    avatars.push({
                        seed: `${settings.seed}-avatar-${i}-${attempts}`,
                        x,
                        y,
                        size,
                        rotation: (Math.random() - 0.5) * 40,
                    });
                    placed = true;
                }
                attempts++;
            }
        }
        return avatars;
    }, [settings.avatarCount, settings.seed]);

    return (
        <BaseBackground settings={settings}>
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
                    <Avatar seed={av.seed} size={av.size} expression={getExpression(av.seed, settings)} />
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
        </BaseBackground>
    );
};

// --- CONTROL COMPONENTS ---

const ControlGroup: React.FC<{ label: string, children: React.ReactNode }> = ({ label, children }) => (
    <div className="mb-8 p-1 group">
        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-5 px-1 group-hover:text-indigo-400 transition-colors">
            {label}
        </label>
        <div className="space-y-6">
            {children}
        </div>
    </div>
);

const RangeSlider: React.FC<{
    label: string,
    value: number,
    min: number,
    max: number,
    defaultValue: number,
    onChange: (val: number) => void,
    unit?: string
}> = ({ label, value, min, max, defaultValue, onChange, unit = "" }) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let val = parseInt(e.target.value);
        // Snap to default if within 4% of range
        const threshold = (max - min) * 0.04;
        if (Math.abs(val - defaultValue) < threshold) {
            val = defaultValue;
        }
        onChange(val);
    };

    return (
        <div>
            <div className="flex justify-between text-[11px] font-bold text-slate-400 mb-2 uppercase tracking-tighter px-1">
                <span>{label}</span>
                <span className="text-indigo-400 font-black">{value}{unit}</span>
            </div>
            <div className="relative flex items-center h-4">
                <div
                    className="absolute h-1.5 w-1.5 bg-indigo-500/40 rounded-full blur-[1px] pointer-events-none z-10"
                    style={{ left: `calc(${((defaultValue - min) / (max - min)) * 100}% - 3px)` }}
                    title="Default Value"
                />
                <input
                    type="range" min={min} max={max} value={value}
                    onChange={handleChange}
                    className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-full appearance-none cursor-pointer relative z-20"
                />
            </div>
        </div>
    );
};

const ColorOption: React.FC<{ value: string, active: boolean, onClick: () => void }> = ({ value, active, onClick }) => (
    <button
        onClick={onClick}
        className={`w-10 h-10 rounded-full bg-linear-to-br ${value} border-2 transition-all p-1 active:scale-90 ${active ? 'border-white scale-125 shadow-lg shadow-white/10' : 'border-transparent opacity-60 hover:opacity-100 hover:scale-110'}`}
    />
);

const AppearanceControls: React.FC<{ settings: any, setSettings: (val: any) => void, showGameBg?: boolean }> = ({ settings, setSettings, showGameBg = false }) => {
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
        <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
            <ControlGroup label="Expression Mode">
                <div className="flex bg-slate-800/50 p-1 rounded-xl border border-slate-700/50">
                    <button
                        onClick={() => setSettings({ ...settings, randomExpressions: false })}
                        className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${!settings.randomExpressions ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                        Fixed
                    </button>
                    <button
                        onClick={() => setSettings({ ...settings, randomExpressions: true })}
                        className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${settings.randomExpressions ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                        Random
                    </button>
                </div>

                {!settings.randomExpressions && (
                    <div className="grid grid-cols-4 gap-2 mt-4 animate-in fade-in zoom-in-95 duration-200">
                        {EXPRESSIONS.map((exp) => (
                            <button
                                key={exp}
                                onClick={() => setSettings({ ...settings, expression: exp })}
                                className={`p-2 rounded-xl text-[10px] font-bold transition-all border ${settings.expression === exp
                                    ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300 shadow-inner'
                                    : 'bg-slate-800/40 border-slate-700/50 text-slate-400 hover:bg-slate-700/50'
                                    }`}
                            >
                                {exp}
                            </button>
                        ))}
                    </div>
                )}
            </ControlGroup>

            <ControlGroup label="Background Style">
                <div className="grid grid-cols-3 gap-2">
                    {showGameBg && (
                        <button
                            onClick={() => setSettings({ ...settings, bgStyle: 'game' })}
                            className={`py-3 rounded-xl text-[10px] font-black uppercase border transition-all ${settings.bgStyle === 'game' ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'}`}
                        >
                            Game
                        </button>
                    )}
                    <button
                        onClick={() => setSettings({ ...settings, bgStyle: 'gradient' })}
                        className={`py-3 rounded-xl text-[10px] font-black uppercase border transition-all ${settings.bgStyle === 'gradient' ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'}`}
                    >
                        Gradient
                    </button>
                    <button
                        onClick={() => setSettings({ ...settings, bgStyle: 'solid' })}
                        className={`py-3 rounded-xl text-[10px] font-black uppercase border transition-all ${settings.bgStyle === 'solid' ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'}`}
                    >
                        Solid
                    </button>
                </div>

                <div className="mt-4 animate-in fade-in duration-300">
                    {settings.bgStyle === 'game' && (
                        <div className="mt-2 animate-in fade-in zoom-in-95 duration-200">
                            <RangeSlider
                                label="Background Tint"
                                min={0} max={360}
                                value={settings.bgTint || 0}
                                defaultValue={0}
                                unit="°"
                                onChange={(val) => setSettings({ ...settings, bgTint: val })}
                            />
                            <p className="text-[10px] text-slate-500 mt-2 italic px-1">
                                Shifts the master gradient hue while keeping the game aesthetic.
                            </p>
                        </div>
                    )}
                    {settings.bgStyle === 'gradient' && (
                        <div className="flex flex-wrap gap-4 px-2">
                            {gradients.map((grad) => (
                                <ColorOption
                                    key={grad}
                                    value={grad}
                                    active={settings.bgGradient === grad}
                                    onClick={() => setSettings({ ...settings, bgGradient: grad.replace('bg-linear', 'bg-gradient') })}
                                />
                            ))}
                        </div>
                    )}
                    {settings.bgStyle === 'solid' && (
                        <div className="flex items-center space-x-4 p-4 bg-slate-800/40 rounded-2xl border border-slate-700/50">
                            <input
                                type="color"
                                value={settings.bgColor}
                                onChange={(e) => setSettings({ ...settings, bgColor: e.target.value })}
                                className="w-12 h-12 rounded-xl bg-transparent appearance-none cursor-pointer border-none p-0"
                            />
                            <div className="flex-1">
                                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">HEX COLOR</span>
                                <input
                                    type="text"
                                    value={settings.bgColor}
                                    onChange={(e) => setSettings({ ...settings, bgColor: e.target.value })}
                                    className="bg-transparent text-indigo-300 font-mono text-xs focus:outline-none w-full"
                                />
                            </div>
                        </div>
                    )}
                </div>
            </ControlGroup>
        </div>
    );
};

const IconControls: React.FC<{ settings: any, setSettings: (val: any) => void }> = ({ settings, setSettings }) => {
    return (
        <div className="space-y-12">
            <AppearanceControls settings={settings} setSettings={setSettings} showGameBg />

            <ControlGroup label="Layout">
                <RangeSlider
                    label="Narrator Size"
                    min={30} max={95}
                    value={settings.narratorSize}
                    defaultValue={DEFAULTS.icon.narratorSize}
                    unit="%"
                    onChange={(val) => setSettings({ ...settings, narratorSize: val })}
                />
                <button
                    onClick={() => setSettings({ ...settings, showTitle: !settings.showTitle })}
                    className={`w-full py-4 rounded-2xl flex items-center justify-center space-x-3 transition-all border ${settings.showTitle
                        ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg'
                        : 'bg-slate-800/40 border-slate-700 text-slate-400 grayscale'
                        }`}
                >
                    <Check className={`w-5 h-5 transition-transform ${settings.showTitle ? 'scale-110' : 'scale-75 opacity-0'}`} />
                    <span className="font-bold tracking-tight">Show App Title</span>
                </button>
            </ControlGroup>
        </div>
    );
};

const LoadingControls: React.FC<{ settings: any, setSettings: (val: any) => void }> = ({ settings, setSettings }) => (
    <div className="space-y-12 animate-in fade-in slide-in-from-right-4 duration-500">
        <AppearanceControls settings={settings} setSettings={setSettings} showGameBg />

        <ControlGroup label="Device Preset">
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-800/50 rounded-xl border border-slate-700/50">
                <button
                    onClick={() => setSettings({ ...settings, preset: 'phone' })}
                    className={`flex items-center justify-center space-x-2 py-3 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${settings.preset === 'phone' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
                >
                    <Smartphone className="w-4 h-4" />
                    <span>Phone</span>
                </button>
                <button
                    onClick={() => setSettings({ ...settings, preset: 'tablet' })}
                    className={`flex items-center justify-center space-x-2 py-3 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${settings.preset === 'tablet' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
                >
                    <Monitor className="w-4 h-4" />
                    <span>Tablet</span>
                </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-2 italic px-1">
                {settings.preset === 'phone' ? 'Portrait aspect ratio (9:16)' : 'Universal iPad/Tablet ratio (3:4)'}
            </p>
        </ControlGroup>
        <ControlGroup label="Canvas Grid">
            <RangeSlider
                label="Columns"
                min={4} max={15}
                value={settings.columns}
                defaultValue={DEFAULTS.loading.columns}
                onChange={(val) => setSettings({ ...settings, columns: val })}
            />
            <RangeSlider
                label="Rows"
                min={4} max={25}
                value={settings.rows}
                defaultValue={DEFAULTS.loading.rows}
                onChange={(val) => setSettings({ ...settings, rows: val })}
            />
            <RangeSlider
                label="Avatar Size"
                min={40} max={120}
                value={settings.avatarSize}
                defaultValue={DEFAULTS.loading.avatarSize}
                unit="px"
                onChange={(val) => setSettings({ ...settings, avatarSize: val })}
            />
            <RangeSlider
                label="Avatar Spacing"
                min={-40} max={60}
                value={settings.spacing}
                defaultValue={DEFAULTS.loading.spacing}
                unit="px"
                onChange={(val) => setSettings({ ...settings, spacing: val })}
            />
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
    </div >
);

const StoreControls: React.FC<{ settings: any, setSettings: (val: any) => void }> = ({ settings, setSettings }) => {
    return (
        <div className="space-y-12 animate-in fade-in slide-in-from-right-4 duration-500">
            <AppearanceControls settings={settings} setSettings={setSettings} showGameBg />

            <ControlGroup label="Narrator Mood">
                <div className="grid grid-cols-4 gap-2">
                    {EXPRESSIONS.map((exp) => (
                        <button
                            key={exp}
                            onClick={() => setSettings({ ...settings, expression: exp })}
                            className={`p-2 rounded-xl text-[10px] font-bold transition-all border ${settings.expression === exp
                                ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300 shadow-inner'
                                : 'bg-slate-800/40 border-slate-700/50 text-slate-400 hover:bg-slate-700'
                                }`}
                        >
                            {exp}
                        </button>
                    ))}
                </div>
            </ControlGroup>

            <ControlGroup label="Crowd Density">
                <RangeSlider
                    label="Background Avatars"
                    min={5} max={50}
                    value={settings.avatarCount}
                    defaultValue={DEFAULTS.store.avatarCount}
                    onChange={(val) => setSettings({ ...settings, avatarCount: val })}
                />
                <button
                    onClick={() => setSettings({ ...settings, seed: Math.random().toString(36) })}
                    className="w-full mt-6 py-4 bg-slate-800/60 border border-slate-700 hover:bg-slate-800 text-slate-300 rounded-2xl flex items-center justify-center space-x-3 transition-all font-bold shadow-lg active:scale-95"
                >
                    <RefreshCw className="w-4 h-4" />
                    <span>Regenerate Layout</span>
                </button>
            </ControlGroup>
        </div>
    );
};
