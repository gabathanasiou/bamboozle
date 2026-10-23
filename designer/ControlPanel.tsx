import React, { useEffect, useMemo, useState } from 'react';
import {
    AlignCenter, AlignJustify, AlignLeft, AlignRight,
    Copy, Crown, Dice5, Download, Eye, FileJson, Home, LogIn, Megaphone, PenLine,
    Play, RotateCw, ScanLine, Settings as SettingsIcon, Shapes, Trash2, Trophy, Users, Vote,
    WifiOff, Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type {
    AdminTab,
    ChangelogState,
    DesignerConfig,
    DesignerDiagnostics,
    DesignerElementInfo,
    GameView,
    ResizeChange,
    ScreenId,
    SelectedStyleProperty,
    TextLength,
    ViewportConfig,
} from './types';
import type { DeepPartial } from './bridge';
import {
    SCREENS, SCREEN_GROUPS, TEXT_LENGTH_OPTIONS, VIEW_OPTIONS, VIEWPORT_BY_PRESET, VIEWPORT_GROUPS,
    getCopy, isGameScreen,
} from './catalog';
import {
    LabBadge, LabButton, LabField, LabNumber, LabSection, LabSegmented, LabSelect, LabText, LabTextArea, LabToggle,
} from './ui';

const ICONS: Record<string, LucideIcon> = {
    Home, Settings: SettingsIcon, WifiOff, Wrench, LogIn, Users, Shapes, Megaphone, PenLine,
    Vote, Eye, Trophy, Crown,
};

const ALIGN_OPTIONS = [
    { value: 'left', label: 'Left', Icon: AlignLeft },
    { value: 'center', label: 'Center', Icon: AlignCenter },
    { value: 'right', label: 'Right', Icon: AlignRight },
    { value: 'justify', label: 'Justify', Icon: AlignJustify },
] as const;

const isActiveAlign = (current: string, value: string) => (
    current === value || (value === 'left' && current === 'start')
);

const SelectedStyleInputs: React.FC<{
    selectedElement: DesignerElementInfo;
    onSetStyle: (property: SelectedStyleProperty, value: string) => void;
}> = ({ selectedElement, onSetStyle }) => {
    const [fontSize, setFontSize] = useState(parseFloat(selectedElement.fontSize) || 0);
    const [lineHeight, setLineHeight] = useState(parseFloat(selectedElement.lineHeight) || 0);

    useEffect(() => {
        setFontSize(parseFloat(selectedElement.fontSize) || 0);
        setLineHeight(parseFloat(selectedElement.lineHeight) || 0);
    }, [selectedElement.selector]);

    return (
        <div className="grid grid-cols-2 gap-2">
            <LabNumber
                label="Font size (px)"
                value={fontSize}
                min={6}
                max={120}
                onChange={(value) => {
                    setFontSize(value);
                    onSetStyle('fontSize', `${value}px`);
                }}
            />
            <LabNumber
                label="Line height (px)"
                value={lineHeight}
                min={0}
                max={160}
                onChange={(value) => {
                    setLineHeight(value);
                    onSetStyle('lineHeight', value > 0 ? `${value}px` : 'normal');
                }}
            />
            <div className="col-span-2 space-y-1">
                <div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Text align</div>
                <div className="flex gap-1 rounded-lg border border-white/10 bg-black/20 p-1">
                    {ALIGN_OPTIONS.map(({ value, label, Icon }) => {
                        const active = isActiveAlign(selectedElement.textAlign, value);
                        return (
                            <button
                                key={value}
                                type="button"
                                title={`Align ${label.toLowerCase()}`}
                                aria-pressed={active}
                                onClick={() => onSetStyle('textAlign', value)}
                                className={`flex flex-1 items-center justify-center rounded-md py-1.5 transition-colors ${
                                    active ? 'bg-yellow-400 text-black' : 'text-slate-400 hover:bg-white/10 hover:text-slate-200'
                                }`}
                            >
                                <Icon size={13} />
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

const ROLE_OPTIONS = [
    { value: 'host' as const, label: 'Host' },
    { value: 'player' as const, label: 'Player' },
    { value: 'audience' as const, label: 'Audience' },
];

const viewFor = (mode: 'online' | 'classic', role: 'host' | 'player' | 'audience'): GameView => {
    if (mode === 'classic') return role === 'host' ? 'classic-host' : role === 'player' ? 'classic-player' : 'classic-audience';
    return role === 'host' ? 'online-host' : role === 'player' ? 'online-player' : 'online-audience';
};

interface ControlPanelProps {
    config: DesignerConfig;
    diagnostics: DesignerDiagnostics | null;
    selectedElement: DesignerElementInfo | null;
    resizeChanges: ResizeChange[];
    status: string | null;
    onChange: (patch: DeepPartial<DesignerConfig>) => void;
    onScreenChange: (screen: ScreenId) => void;
    onViewChange: (view: GameView) => void;
    onContentLengthChange: (length: TextLength) => void;
    onViewportChange: (width: number, height: number, preset: string) => void;
    onRotate: () => void;
    onReset: () => void;
    onRandomize: () => void;
    onCopyBrief: () => void;
    onCopyJson: () => void;
    onApplyJson: (json: string) => void;
    onCopyText: (text: string) => void;
    onScan: () => void;
    onExportPng: () => void;
    onReplay: () => void;
    onRevealIssue: (selector: string) => void;
    onResetElementSize: () => void;
    onResetAllSizes: () => void;
    onSetSelectedStyle: (property: SelectedStyleProperty, value: string) => void;
    onCopyResizeRequest: () => void;
    onClearOverrides: () => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
    config,
    diagnostics,
    selectedElement,
    resizeChanges,
    status,
    onChange,
    onScreenChange,
    onViewChange,
    onContentLengthChange,
    onViewportChange,
    onRotate,
    onReset,
    onRandomize,
    onCopyBrief,
    onCopyJson,
    onApplyJson,
    onCopyText,
    onScan,
    onExportPng,
    onReplay,
    onRevealIssue,
    onResetElementSize,
    onResetAllSizes,
    onSetSelectedStyle,
    onCopyResizeRequest,
    onClearOverrides,
}) => {
    const [json, setJson] = useState('');
    const copy = useMemo(() => getCopy(config), [config]);
    const view = config.view;
    const mode = view.startsWith('classic') ? 'classic' : 'online';
    const role = view.endsWith('host') ? 'host' : view.endsWith('audience') ? 'audience' : 'player';
    const isJoin = config.screen === 'join';
    const gameScreen = isGameScreen(config.screen);
    const showAnswers = ['writing', 'voting'].includes(config.screen);
    const showVotes = config.screen === 'voting';
    const showSubmitted = config.screen === 'writing';
    const showCurrentVote = config.screen === 'voting';
    const showTimer = ['category', 'writing', 'voting'].includes(config.screen);
    const showRounds = ['intro', 'writing', 'voting', 'reveal', 'leaderboard'].includes(config.screen);
    const showTotalOnly = config.screen === 'lobby';
    const showScoreSpread = ['leaderboard', 'gameOver'].includes(config.screen);
    const showReady = config.screen === 'lobby';
    const showCategoryState = config.screen === 'category';
    const showRevealState = config.screen === 'reveal';
    const showLeaderboardState = config.screen === 'leaderboard';
    const showEmotes = !['lobby', 'leaderboard', 'gameOver'].includes(config.screen);
    const showContentFact = ['intro', 'writing', 'voting', 'reveal'].includes(config.screen);
    const showContentCategory = ['category', 'intro', 'writing', 'voting', 'reveal'].includes(config.screen);
    const showContentAnswers = ['writing', 'voting', 'reveal'].includes(config.screen);
    const showContentNames = gameScreen;

    const setGame = (patch: DeepPartial<DesignerConfig['game']>) => onChange({ game: patch });
    const setApp = (patch: DeepPartial<DesignerConfig['app']>) => onChange({ app: patch });
    const setPreview = (patch: DeepPartial<DesignerConfig['preview']>) => onChange({ preview: patch });
    const setViewport = (width: number, height: number, preset = 'custom') => {
        onViewportChange(width, height, preset);
    };
    const setCopyOverride = (key: 'fact' | 'category' | 'answer', value: string) => {
        onChange({ overrides: { [key]: value } as DeepPartial<DesignerConfig['overrides']> });
    };
    const setLieOverride = (index: number, value: string) => {
        onChange({ overrides: { lies: { ...(config.overrides.lies ?? {}), [index]: value } } });
    };
    const setNameOverride = (index: number, value: string) => {
        onChange({ overrides: { names: { ...(config.overrides.names ?? {}), [index]: value } } });
    };
    const viewportPreset = VIEWPORT_BY_PRESET[config.viewport.preset];
    const hasOverrides = Object.keys(config.overrides).length > 0;

    return (
        <div className="flex h-full min-h-0 flex-col overflow-y-auto">
            <LabSection title="Screen" subtitle="Which real component to mount" defaultOpen>
                {SCREEN_GROUPS.map((group) => (
                    <div key={group} className="space-y-1">
                        <div className="pt-1 text-[9px] font-black uppercase tracking-[0.2em] text-slate-600">{group}</div>
                        <div className="grid grid-cols-2 gap-1">
                            {SCREENS.filter((screen) => screen.group === group).map((screen) => {
                                const Icon = ICONS[screen.icon] ?? Shapes;
                                const active = config.screen === screen.id;
                                return (
                                    <button
                                        key={screen.id}
                                        type="button"
                                        onClick={() => onScreenChange(screen.id)}
                                        title={screen.hint}
                                        className={`flex items-center gap-1.5 rounded-lg border px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide transition-colors ${
                                            active
                                                ? 'border-yellow-400/40 bg-yellow-400/10 text-yellow-200'
                                                : 'border-white/5 bg-white/[0.02] text-slate-400 hover:bg-white/5 hover:text-slate-200'
                                        }`}
                                    >
                                        <Icon size={13} />
                                        <span className="truncate">{screen.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </LabSection>

            {(gameScreen || isJoin) && (
                <LabSection title="View" subtitle="Online unified vs classic split-screen" defaultOpen>
                    {isJoin ? (
                        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] text-slate-400">
                            Join flow · online player
                        </div>
                    ) : (
                        <>
                            <LabSegmented
                                value={mode}
                                options={[
                                    { value: 'online', label: 'Online' },
                                    { value: 'classic', label: 'Classic' },
                                ]}
                                onChange={(nextMode) => onViewChange(viewFor(nextMode, role))}
                            />
                            <LabSegmented
                                value={role}
                                options={ROLE_OPTIONS}
                                onChange={(nextRole) => onViewChange(viewFor(mode, nextRole))}
                            />
                            <div className="text-[9px] text-slate-500">
                                Classic views are the legacy split-screen set; online is the shipping unified UI.
                            </div>
                        </>
                    )}
                </LabSection>
            )}

            {gameScreen && (
                <LabSection title="Game state" subtitle="Only controls used by this screen" defaultOpen>
                    <div className="grid grid-cols-2 gap-2">
                        <LabNumber label="Players" value={config.game.players} min={1} max={6} onChange={(players) => setGame({ players })} />
                        <LabNumber label="Audience" value={config.game.audience} min={0} max={12} onChange={(audience) => setGame({ audience })} />
                    </div>
                    {showAnswers && (
                        <LabNumber label={config.screen === 'writing' ? 'Answer slots (lies)' : 'Answers'} value={config.game.answers} min={2} max={7} onChange={(answers) => setGame({ answers })} />
                    )}
                    {showVotes && (
                        <div className="grid grid-cols-2 gap-2">
                            <LabNumber label="Player voters" value={config.game.voterCount} min={0} max={config.game.players} onChange={(voterCount) => setGame({ voterCount })} />
                            <LabNumber label="Audience voters" value={config.game.audienceVotes} min={0} max={config.game.audience} onChange={(audienceVotes) => setGame({ audienceVotes })} />
                        </div>
                    )}
                    {showSubmitted && (
                        <LabField label="Submitted lies">
                            <LabSegmented
                                value={config.game.submitted}
                                options={[{ value: 'none', label: 'None' }, { value: 'some', label: 'Some' }, { value: 'all', label: 'All' }]}
                                onChange={(submitted) => setGame({ submitted })}
                            />
                        </LabField>
                    )}
                    {showCurrentVote && (
                        <LabToggle label="Current player voted" checked={config.game.currentVote} onChange={(currentVote) => setGame({ currentVote })} />
                    )}
                    {showTimer && (
                        <LabNumber label="Timer (seconds)" value={config.game.timeLeft} min={0} max={120} onChange={(timeLeft) => setGame({ timeLeft })} />
                    )}
                    {showRounds && (
                        <div className="grid grid-cols-2 gap-2">
                            <LabNumber label="Round" value={config.game.round} min={1} max={config.game.totalRounds} onChange={(round) => setGame({ round })} />
                            <LabNumber label="Total rounds" value={config.game.totalRounds} min={1} max={10} onChange={(totalRounds) => setGame({ totalRounds })} />
                        </div>
                    )}
                    {showTotalOnly && (
                        <LabNumber label="Total rounds" value={config.game.totalRounds} min={1} max={10} onChange={(totalRounds) => setGame({ totalRounds })} />
                    )}
                    {showScoreSpread && (
                        <LabField label="Score spread">
                            <LabSegmented
                                value={config.game.scoreSpread}
                                options={[{ value: 'close', label: 'Close' }, { value: 'wide', label: 'Wide' }, { value: 'tie', label: 'Tie' }]}
                                onChange={(scoreSpread) => setGame({ scoreSpread })}
                            />
                        </LabField>
                    )}
                    {showReady && (
                        <LabField label="Ready players">
                            <LabSegmented
                                value={config.game.ready}
                                options={[{ value: 'none', label: 'None' }, { value: 'some', label: 'Some' }, { value: 'all', label: 'All' }]}
                                onChange={(ready) => setGame({ ready })}
                            />
                        </LabField>
                    )}
                    {showCategoryState && (
                        <>
                            <LabField label="Category selector">
                                <LabSegmented
                                    value={config.game.categorySelector}
                                    options={[{ value: 'me', label: 'Me' }, { value: 'other', label: 'Other' }]}
                                    onChange={(categorySelector) => setGame({ categorySelector })}
                                />
                            </LabField>
                            <LabToggle label="Category selected" checked={config.game.categorySelected} onChange={(categorySelected) => setGame({ categorySelected })} />
                        </>
                    )}
                    {showRevealState && (
                        <>
                            <LabField label="Reveal stage">
                                <LabSegmented
                                    value={config.game.revealStage}
                                    options={[
                                        { value: 'INTRO', label: 'Intro' },
                                        { value: 'CARD', label: 'Card' },
                                        { value: 'VOTERS', label: 'Voters' },
                                        { value: 'AUTHOR', label: 'Author' },
                                    ]}
                                    onChange={(revealStage) => setGame({ revealStage })}
                                />
                            </LabField>
                            <LabField label="Outcome">
                                <LabSegmented
                                    value={config.game.revealOutcome}
                                    options={[
                                        { value: 'found', label: 'Found' },
                                        { value: 'not-found', label: 'Not found' },
                                        { value: 'mistake', label: 'Mistake' },
                                    ]}
                                    onChange={(revealOutcome) => {
                                        if (revealOutcome === 'not-found') {
                                            setGame({ revealOutcome, revealVoters: 0 });
                                        } else if (revealOutcome === 'found') {
                                            setGame({ revealOutcome, revealVoters: Math.max(1, config.game.revealVoters) });
                                        } else {
                                            setGame({ revealOutcome, revealVoters: config.game.revealVoters });
                                        }
                                    }}
                                />
                            </LabField>
                            {config.game.revealOutcome === 'not-found' ? (
                                <div className="rounded-md border border-white/5 bg-white/[0.03] px-3 py-2 text-[10px] text-slate-500">
                                    Nobody found the correct answer · 0 voters
                                </div>
                            ) : (
                                <LabNumber
                                    label={config.game.revealOutcome === 'found' ? 'Players who found it' : 'Players who made the mistake'}
                                    value={config.game.revealVoters}
                                    min={config.game.revealOutcome === 'found' ? 1 : 0}
                                    max={config.game.players}
                                    onChange={(revealVoters) => setGame({ revealVoters })}
                                />
                            )}
                        </>
                    )}
                    {showLeaderboardState && (
                        <LabField label="Leaderboard stage">
                            <LabSegmented
                                value={config.game.leaderboardStage}
                                options={[
                                    { value: 'INTRO', label: 'Intro' },
                                    { value: 'REVEAL', label: 'Reveal' },
                                    { value: 'LEADER', label: 'Leader' },
                                ]}
                                onChange={(leaderboardStage) => setGame({ leaderboardStage })}
                            />
                        </LabField>
                    )}
                </LabSection>
            )}

            {gameScreen && (
                <LabSection title="Presentation" subtitle="Language, overlays and narrator" defaultOpen={false}>
                    <div className="grid grid-cols-2 gap-2">
                        <LabField label="Language">
                            <LabSegmented
                                value={config.language}
                                options={[{ value: 'en', label: 'EN' }, { value: 'el', label: 'EL' }]}
                                onChange={(language) => onChange({ language })}
                            />
                        </LabField>
                        <LabSelect
                            label="Overlay"
                            value={config.game.overlay}
                            options={[
                                { value: 'none', label: 'None' },
                                { value: 'host-disconnected', label: 'Host lost' },
                                { value: 'room-closed', label: 'Room closed' },
                            ]}
                            onChange={(overlay) => setGame({ overlay: overlay as DesignerConfig['game']['overlay'] })}
                        />
                    </div>
                    <LabToggle label="Narrator speaking" checked={config.game.isSpeaking} onChange={(isSpeaking) => setGame({ isSpeaking })} />
                    {showEmotes && (
                        <LabNumber label="Emotes" value={config.game.emotes} min={0} max={4} onChange={(emotes) => setGame({ emotes })} />
                    )}
                </LabSection>
            )}

            {isJoin && (
                <LabSection title="Join state" subtitle="Code / name / saved session" defaultOpen>
                    <LabField label="Step">
                        <LabSegmented
                            value={config.game.joinStep}
                            options={[{ value: 'CODE', label: 'Code' }, { value: 'NAME', label: 'Name' }]}
                            onChange={(joinStep) => setGame({ joinStep })}
                        />
                    </LabField>
                    <LabField label="Room phase">
                        <LabSegmented
                            value={config.game.roomPhase}
                            options={[{ value: 'lobby', label: 'Lobby' }, { value: 'in-progress', label: 'In progress' }]}
                            onChange={(roomPhase) => setGame({ roomPhase })}
                        />
                    </LabField>
                    <LabToggle label="Saved session card" checked={config.game.savedSession} onChange={(savedSession) => setGame({ savedSession })} />
                    <div className="grid grid-cols-2 gap-2">
                        <LabNumber label="Players in room" value={config.game.players} min={1} max={6} onChange={(players) => setGame({ players })} />
                        <LabField label="Language">
                            <LabSegmented
                                value={config.language}
                                options={[{ value: 'en', label: 'EN' }, { value: 'el', label: 'EL' }]}
                                onChange={(language) => onChange({ language })}
                            />
                        </LabField>
                    </div>
                    <LabText label="Join name" value={config.game.joinName} onChange={(joinName) => setGame({ joinName })} placeholder="MARIA" />
                    <LabText label="Code error" value={config.game.codeError} onChange={(codeError) => setGame({ codeError })} placeholder="Room not found" />
                </LabSection>
            )}

            {gameScreen && (
                <LabSection title="Content" subtitle="Stress copy, answers and names" defaultOpen={false}>
                    <LabField label="Length stress">
                        <LabSegmented value={config.contentLength} options={TEXT_LENGTH_OPTIONS} onChange={onContentLengthChange} />
                    </LabField>
                    {showContentFact && (
                        <LabTextArea label="Fact (keep <BLANK>)" value={copy.fact} onChange={(value) => setCopyOverride('fact', value)} rows={4} />
                    )}
                    {showContentCategory && (
                        <LabText label="Category" value={copy.category} onChange={(value) => setCopyOverride('category', value)} />
                    )}
                    {showContentAnswers && (
                        <>
                            <LabText label="Truth answer" value={copy.answer} onChange={(value) => setCopyOverride('answer', value)} />
                            <div className="space-y-2">
                                {Array.from({ length: Math.max(1, config.game.answers - 1) }, (_, index) => (
                                    <LabText
                                        key={`lie-${index}`}
                                        label={`Lie ${index + 1}`}
                                        value={copy.lies[index] ?? ''}
                                        onChange={(value) => setLieOverride(index, value)}
                                    />
                                ))}
                            </div>
                        </>
                    )}
                    {showContentNames && (
                        <div className="space-y-2">
                            {Array.from({ length: config.game.players }, (_, index) => (
                                <LabText
                                    key={`name-${index}`}
                                    label={index === 0 ? 'Host name' : `Player ${index + 1} name`}
                                    value={copy.names[index] ?? ''}
                                    onChange={(value) => setNameOverride(index, value)}
                                />
                            ))}
                        </div>
                    )}
                    <LabButton onClick={onClearOverrides} variant="ghost" fullWidth disabled={!hasOverrides}>
                        <Trash2 size={12} /> Clear copy overrides
                    </LabButton>
                </LabSection>
            )}

            {config.screen === 'home' && (
                <LabSection title="Home state" defaultOpen>
                    <LabToggle label="Mobile home layout" checked={config.app.homeMobile} onChange={(homeMobile) => setApp({ homeMobile })} />
                    <LabToggle label="Show dev chrome" checked={config.app.showDevChrome} onChange={(showDevChrome) => setApp({ showDevChrome })} hint="Test Mode button" />
                    <LabToggle label="Room manager modal" checked={config.app.roomManagerOpen} onChange={(roomManagerOpen) => setApp({ roomManagerOpen })} />
                    <LabField label="Active rooms">
                        <LabSegmented
                            value={String(config.app.roomCount) as '1' | '2'}
                            options={[{ value: '1', label: '1 room' }, { value: '2', label: '2 rooms' }]}
                            onChange={(roomCount) => setApp({ roomCount: Number(roomCount) === 2 ? 2 : 1 })}
                        />
                    </LabField>
                </LabSection>
            )}

            {config.screen === 'settings' && (
                <LabSection title="Settings state" defaultOpen>
                    <LabToggle label="Show dev section" checked={config.app.showDevChrome} onChange={(showDevChrome) => setApp({ showDevChrome })} />
                    <LabToggle label="Changelog open" checked={config.app.changelogOpen} onChange={(changelogOpen) => setApp({ changelogOpen })} />
                    <LabField label="Changelog state">
                        <LabSegmented
                            value={config.app.changelogState}
                            options={[{ value: 'loaded', label: 'Loaded' }, { value: 'loading', label: 'Loading' }, { value: 'error', label: 'Error' }]}
                            onChange={(changelogState) => setApp({ changelogState: changelogState as ChangelogState })}
                        />
                    </LabField>
                    <LabToggle label="Local server" checked={config.app.useLocalServer} onChange={(useLocalServer) => setApp({ useLocalServer })} />
                    <LabToggle label="Premium voices" checked={config.app.usePremiumVoices} onChange={(usePremiumVoices) => setApp({ usePremiumVoices })} />
                </LabSection>
            )}

            {config.screen === 'admin' && (
                <LabSection title="Admin state" defaultOpen>
                    <LabField label="Tab">
                        <LabSegmented
                            value={config.app.adminTab}
                            options={[
                                { value: 'ACTIONS', label: 'Actions' },
                                { value: 'PROGRESS', label: 'Progress' },
                                { value: 'FAILURES', label: 'Failures' },
                            ]}
                            onChange={(adminTab) => setApp({ adminTab: adminTab as AdminTab })}
                        />
                    </LabField>
                    <LabToggle label="Job running" checked={config.app.adminRunning} onChange={(adminRunning) => setApp({ adminRunning })} />
                    <LabNumber label="Failures" value={config.app.adminFailures} min={0} max={6} onChange={(adminFailures) => setApp({ adminFailures })} />
                </LabSection>
            )}

            <LabSection title="Viewport" subtitle="Real iframe size, not a scaled div" defaultOpen>
                <LabSelect
                    label="Preset"
                    value={config.viewport.preset}
                    groups={[
                        ...VIEWPORT_GROUPS,
                        { label: 'Custom', options: [{ value: 'custom', label: 'Custom size' }] },
                    ]}
                    onChange={(preset) => {
                        if (preset === 'custom') {
                            onViewportChange(config.viewport.width, config.viewport.height, 'custom');
                            return;
                        }
                        const next = VIEWPORT_BY_PRESET[preset];
                        if (next) onViewportChange(next.width, next.height, next.preset);
                    }}
                />
                <div className="grid grid-cols-2 gap-2">
                    <LabNumber label="Width" value={config.viewport.width} min={320} max={3840} onChange={(width) => setViewport(width, config.viewport.height)} />
                    <LabNumber label="Height" value={config.viewport.height} min={320} max={2160} onChange={(height) => setViewport(config.viewport.width, height)} />
                </div>
                <LabButton onClick={onRotate} fullWidth>
                    <RotateCw size={12} /> Rotate {viewportPreset ? `(${viewportPreset.label})` : ''}
                </LabButton>
                <LabButton onClick={onRandomize} fullWidth>
                    <Dice5 size={12} /> Randomize state
                </LabButton>
                <div className="text-[9px] leading-relaxed text-slate-600">
                    Live element edits persist when you switch viewport, so you can compare the same
                    adjusted design at another size. Use Reset all to return to the natural responsive layout.
                </div>
            </LabSection>

            <LabSection title="Inspect" subtitle="Overflow, outlines and element details" defaultOpen={false}>
                <div className="grid grid-cols-2 gap-2">
                    <LabToggle label="Inspect" checked={config.preview.inspect} onChange={(inspect) => setPreview({ inspect })} />
                    <LabToggle label="Resize selected" checked={config.preview.resizeSelection} onChange={(resizeSelection) => setPreview({ resizeSelection })} hint="Preview only; drag the yellow handle" />
                    <LabToggle label="Apply to similar" checked={config.preview.applyToSimilar} onChange={(applyToSimilar) => setPreview({ applyToSimilar })} hint="On by default · same tag + classes" />
                    <LabToggle label="Outlines" checked={config.preview.outlines} onChange={(outlines) => setPreview({ outlines })} />
                    <LabToggle label="Show issues" checked={config.preview.showIssues} onChange={(showIssues) => setPreview({ showIssues })} />
                    <LabToggle label="Reduce motion" checked={config.preview.reduceMotion} onChange={(reduceMotion) => setPreview({ reduceMotion })} />
                    <LabToggle label="Muted" checked={config.preview.muted} onChange={(muted) => setPreview({ muted })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <LabButton onClick={onScan}><ScanLine size={12} /> Scan</LabButton>
                    <LabButton onClick={onReplay}><Play size={12} /> Replay</LabButton>
                    <LabButton onClick={onExportPng}><Download size={12} /> PNG</LabButton>
                    <LabButton onClick={onReset} variant="danger"><Trash2 size={12} /> Reset</LabButton>
                </div>

                <div className="rounded-lg border border-white/10 bg-black/20 p-2 font-mono text-[9px] text-slate-500">
                    {diagnostics
                        ? `${diagnostics.viewport.width}×${diagnostics.viewport.height} · scroll ${diagnostics.scroll.width}×${diagnostics.scroll.height} · ${diagnostics.issues.length} issue${diagnostics.issues.length === 1 ? '' : 's'}`
                        : 'No scan yet'}
                </div>

                <div className="space-y-1">
                    {diagnostics?.issues.length ? diagnostics.issues.map((issue) => (
                        <button
                            key={issue.id}
                            type="button"
                            onClick={() => onRevealIssue(issue.selector)}
                            className="w-full rounded-md border border-red-400/10 bg-red-400/5 px-2 py-1.5 text-left hover:bg-red-400/10"
                        >
                            <span className="flex items-center justify-between gap-2">
                                <span className="truncate text-[10px] font-bold text-red-200">{issue.label}</span>
                                <LabBadge tone={issue.severity === 'error' ? 'bad' : 'warn'}>{issue.kind}</LabBadge>
                            </span>
                            <span className="mt-0.5 block truncate font-mono text-[9px] text-red-300/60">{issue.detail}</span>
                        </button>
                    )) : (
                        <div className="text-[10px] text-slate-600">No layout issues detected.</div>
                    )}
                </div>

                {selectedElement && (
                    <div className="space-y-1.5 rounded-lg border border-sky-400/20 bg-sky-400/5 p-2">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-black uppercase tracking-wide text-sky-200">Selected element</span>
                            <div className="flex items-center gap-1">
                                <LabButton onClick={() => onCopyText(selectedElement.selector)} variant="ghost"><Copy size={11} /> Selector</LabButton>
                                <LabButton onClick={onResetElementSize} variant="ghost" title="Reset size, type and alignment"><RotateCw size={11} /> Reset</LabButton>
                            </div>
                        </div>
                        <div className="break-all font-mono text-[9px] text-sky-200/70">{selectedElement.selector}</div>
                        <div className="grid grid-cols-2 gap-1 font-mono text-[9px] text-slate-400">
                            <span>{Math.round(selectedElement.rect.width)}×{Math.round(selectedElement.rect.height)}</span>
                            <span>{selectedElement.fontSize}/{selectedElement.lineHeight}</span>
                            <span className="capitalize">align {selectedElement.textAlign}</span>
                            <span>overflow {selectedElement.overflowX}/{selectedElement.overflowY}</span>
                            <span>scroll {selectedElement.scrollWidth}×{selectedElement.scrollHeight}</span>
                        </div>
                        {selectedElement.text && <div className="line-clamp-3 text-[10px] text-slate-500">{selectedElement.text}</div>}
                        <SelectedStyleInputs selectedElement={selectedElement} onSetStyle={onSetSelectedStyle} />
                        <div className="text-[9px] text-sky-300/50">Live size, type and alignment are preview-only; ask the agent to make them permanent.</div>
                    </div>
                )}

                {resizeChanges.length > 0 && (
                    <div className="space-y-1.5 rounded-lg border border-yellow-400/20 bg-yellow-400/5 p-2">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-black uppercase tracking-wide text-yellow-200">Live changes</span>
                            <LabButton onClick={onResetAllSizes} variant="ghost"><RotateCw size={11} /> Reset all</LabButton>
                        </div>
                        {resizeChanges.map((change) => (
                            <button
                                key={change.selector}
                                type="button"
                                onClick={() => onRevealIssue(change.selector)}
                                className="w-full rounded-md border border-yellow-400/10 bg-black/20 px-2 py-1.5 text-left hover:bg-yellow-400/10"
                            >
                                <div className="truncate text-[10px] font-bold text-yellow-100">{change.text || change.label}</div>
                                <div className="mt-0.5 font-mono text-[9px] text-yellow-300/60">
                                    {change.before.width}×{change.before.height} → {change.after.width}×{change.after.height}
                                    {' · '}
                                    {change.before.fontSize} → {change.after.fontSize}
                                    {change.before.textAlign !== change.after.textAlign
                                        ? ` · ${change.before.textAlign}→${change.after.textAlign}`
                                        : ''}
                                    {change.similarCount > 1 ? ` · ${change.similarCount} similar` : ''}
                                </div>
                            </button>
                        ))}
                        <LabButton onClick={onCopyResizeRequest} variant="primary" fullWidth>
                            <Copy size={12} /> Copy resize request
                        </LabButton>
                        <div className="text-[9px] leading-relaxed text-slate-600">
                            Paste the request to an agent; the design-lab-handoff skill turns it
                            into responsive code at the breakpoint shown above.
                        </div>
                    </div>
                )}
            </LabSection>

            <LabSection title="Share / agent" subtitle="URL, JSON and brief" defaultOpen={false}>
                <LabTextArea
                    label="Notes for the agent"
                    value={config.notes}
                    onChange={(notes) => onChange({ notes })}
                    rows={3}
                    placeholder="e.g. the fact card clips at 375px with long Greek copy"
                />
                <div className="grid grid-cols-2 gap-2">
                    <LabButton onClick={onCopyBrief} variant="primary"><Copy size={12} /> Agent brief</LabButton>
                    <LabButton onClick={onCopyJson}><FileJson size={12} /> Copy JSON</LabButton>
                </div>
                <LabTextArea
                    label="Paste JSON config"
                    value={json}
                    onChange={setJson}
                    rows={5}
                    mono
                    placeholder='{ "screen": "reveal", ... }'
                />
                <LabButton onClick={() => { onApplyJson(json); setJson(''); }} fullWidth disabled={!json.trim()}>
                    Apply JSON
                </LabButton>
                {status && <div className="rounded-md border border-green-400/20 bg-green-400/5 px-2 py-1.5 text-[10px] text-green-300">{status}</div>}
                <div className="text-[9px] leading-relaxed text-slate-600">
                    The URL hash is the reproducible scene. The preview is the real component tree; code changes appear here live.
                </div>
            </LabSection>
        </div>
    );
};
