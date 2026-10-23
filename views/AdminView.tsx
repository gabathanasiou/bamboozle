import React, { useState, useEffect, useCallback } from 'react';
import { PHRASES_EN } from '../i18n/narrator/en';
import { PHRASES_EL } from '../i18n/narrator/el';
import { QUESTIONS_EN } from '../i18n/questions/en';
import { QUESTIONS_EL } from '../i18n/questions/el';

// Helper to extract static phrases
const getStaticPhrases = (phrasesObj: any, prefix = ''): string[] => {
    let staticLines: string[] = [];

    for (const key in phrasesObj) {
        const value = phrasesObj[key];
        if (Array.isArray(value)) {
            value.forEach(str => {
                if (!str.includes('{')) {
                    staticLines.push(str);
                }
            });
        } else if (typeof value === 'object') {
            staticLines = [...staticLines, ...getStaticPhrases(value, `${prefix}${key}.`)];
        }
    }
    return staticLines;
};

// Helper to extract question text (Fact + Answer + Lies + Category)
const getQuestionText = (questions: any[], phrasesObj: any): string[] => {
    const texts: string[] = [];
    const blankWord = (phrasesObj.BLANK_WORD && phrasesObj.BLANK_WORD[0]) || 'blank';

    questions.forEach(q => {
        // 1. The Fact as read during the round (e.g., "... on blank of ...")
        const roundFact = q.fact.replace('<BLANK>', blankWord);
        if (!roundFact.includes('{')) texts.push(roundFact);

        // 2. The Fact as read during the REVEAL (e.g., "... on the top floor of ...")
        const revealFact = q.fact.replace('<BLANK>', q.answer);
        if (!revealFact.includes('{')) texts.push(revealFact);

        // Note: Standalone answers, categories, and bot lies are excluded 
        // as they are now generated on-the-fly to prefer natural "single-sentence" flow.
    });
    return texts;
};

export interface AdminPreviewData {
    status?: any;
    failures?: any[];
    logs?: string[];
}

interface AdminViewProps {
    /** Design-lab only: no polling/fetches, deterministic data. */
    previewMode?: boolean;
    initialTab?: 'ACTIONS' | 'PROGRESS' | 'FAILURES';
    previewData?: AdminPreviewData;
}

export const AdminView: React.FC<AdminViewProps> = ({ previewMode = false, initialTab = 'ACTIONS', previewData }) => {
    const [tab, setTab] = useState<'ACTIONS' | 'PROGRESS' | 'FAILURES'>(initialTab);
    const [status, setStatus] = useState<any>(previewData?.status ?? null);
    const [failures, setFailures] = useState<any[]>(previewData?.failures ?? []);
    const [logs, setLogs] = useState<string[]>(previewData?.logs ?? []);
    const [isLoading, setIsLoading] = useState(false);
    const [isTestMode, setIsTestMode] = useState(true);

    // Helper to get server URL (consistent with gameService)
    const getServerUrl = useCallback(() => {
        const settings = localStorage.getItem('bamboozle_settings');
        if (settings) {
            const parsed = JSON.parse(settings);
            if (parsed.useLocalServer) {
                return parsed.customServerUrl || 'http://localhost:3001';
            }
        }
        return import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
    }, []);

    const serverUrl = getServerUrl();

    // Design lab: follow the selected tab/data without remounting the screen.
    useEffect(() => {
        if (previewMode) setTab(initialTab);
    }, [previewMode, initialTab]);

    useEffect(() => {
        if (!previewMode) return;
        setStatus(previewData?.status ?? null);
        setFailures(previewData?.failures ?? []);
        setLogs(previewData?.logs ?? []);
    }, [previewMode, previewData]);

    // Poll status
    useEffect(() => {
        if (previewMode) return;
        const interval = setInterval(() => {
            fetchAdminStatus();
        }, 1000);
        return () => clearInterval(interval);
    }, [serverUrl, previewMode]);

    const fetchAdminStatus = async () => {
        if (previewMode) return;
        try {
            const res = await fetch(`${serverUrl}/api/admin/status`);
            const data = await res.json();
            setStatus(data);
        } catch (e) {
            console.error("Failed to fetch status", e);
        }
    };

    const fetchFailures = async () => {
        if (previewMode) return;
        try {
            const res = await fetch(`${serverUrl}/api/admin/failures`);
            const data = await res.json();
            setFailures(data);
        } catch (e) {
            console.error("Failed to fetch failures", e);
        }
    };

    useEffect(() => {
        if (previewMode) return;
        if (tab === 'FAILURES') {
            fetchFailures();
        }
    }, [tab, previewMode]);

    const handleGenerate = async (type: 'PHRASES' | 'QUESTIONS', lang: 'en' | 'el') => {
        if (previewMode) return;
        setIsLoading(true);
        let items: string[] = [];

        if (type === 'PHRASES') {
            items = lang === 'en' ? getStaticPhrases(PHRASES_EN) : getStaticPhrases(PHRASES_EL);
        } else {
            const phrases = lang === 'en' ? PHRASES_EN : PHRASES_EL;
            const questions = lang === 'en' ? QUESTIONS_EN : QUESTIONS_EL;
            items = getQuestionText(questions, phrases);
        }

        if (isTestMode) {
            items = items.slice(0, 5);
        }

        try {
            const res = await fetch(`${serverUrl}/api/admin/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items, language: lang })
            });
            const data = await res.json();
            setLogs(prev => [...prev, `Started ${type} (${lang}): ${data.message} (${data.total} items)`]);
            setTab('PROGRESS');
        } catch (e) {
            console.error(e);
            setLogs(prev => [...prev, `Error starting job: ${e}`]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleRetry = async () => {
        if (previewMode) return;
        try {
            await fetch(`${serverUrl}/api/admin/retry`, { method: 'POST' });
            setLogs(prev => [...prev, "Started Retry Job"]);
            setTab('PROGRESS');
        } catch (e) {
            console.error(e);
        }
    };

    const handleClearCache = async () => {
        if (previewMode) return;
        if (!confirm("Are you sure? This will delete all files in the bucket!")) return;
        try {
            const res = await fetch(`${serverUrl}/api/admin/clear-cache`, { method: 'POST' });
            const data = await res.json();
            setLogs(prev => [...prev, `Cache Cleared: ${data.deleted} files deleted.`]);
        } catch (e) {
            console.error(e);
        }
    };

    const handleClearFailures = async () => {
        if (previewMode) return;
        try {
            await fetch(`${serverUrl}/api/admin/clear-failures`, { method: 'POST' });
            setFailures([]);
            setLogs(prev => [...prev, `Failures cleared.`]);
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white p-8 font-sans">
            <header className="mb-8 flex justify-between items-center">
                <h1 className="text-3xl font-bold text-yellow-500">Bamboozle Admin</h1>
                <div className="space-x-4">
                    <button onClick={() => setTab('ACTIONS')} className={`px-4 py-2 rounded ${tab === 'ACTIONS' ? 'bg-blue-600' : 'bg-gray-700'}`}>Actions</button>
                    <button onClick={() => setTab('PROGRESS')} className={`px-4 py-2 rounded ${tab === 'PROGRESS' ? 'bg-blue-600' : 'bg-gray-700'}`}>Progress</button>
                    <button onClick={() => setTab('FAILURES')} className={`px-4 py-2 rounded ${tab === 'FAILURES' ? 'bg-red-600' : 'bg-gray-700'}`}>Failures</button>
                </div>
            </header>

            {status && status.isRunning && (
                <div className="bg-blue-900 border-l-4 border-blue-500 p-4 mb-6">
                    <div className="flex justify-between items-end mb-1">
                        <div>
                            <span className="block text-xs font-semibold opacity-70 uppercase tracking-wider">Progress</span>
                            <span className="text-xl font-bold">{status.current} / {status.total}</span>
                        </div>
                        <div className="text-right">
                            <span className="block text-xs font-semibold opacity-70 uppercase tracking-wider">Cache Hits</span>
                            <span className="text-xl font-bold text-yellow-400">{status.hits || 0}</span>
                        </div>
                    </div>
                    <div className="flex justify-between text-xs mt-1 opacity-70">
                        <span>Items: {status.success} Generated, {status.failed} Failed</span>
                        <span>{(status.current / status.total * 100).toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-blue-800 h-2 mt-2 rounded">
                        <div className="bg-blue-400 h-2 rounded transition-all duration-300" style={{ width: `${(status.current / status.total * 100)}%` }}></div>
                    </div>
                </div>
            )}

            {tab === 'ACTIONS' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold">Actions</h2>
                            <label className="flex items-center gap-2 cursor-pointer bg-black/30 px-3 py-1 rounded-full text-xs">
                                <input
                                    type="checkbox"
                                    checked={isTestMode}
                                    onChange={(e) => setIsTestMode(e.target.checked)}
                                />
                                Test Mode (5 items)
                            </label>
                        </div>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <button
                                    onClick={() => handleGenerate('PHRASES', 'en')}
                                    disabled={status?.isRunning || isLoading}
                                    className="bg-green-600 hover:bg-green-700 disabled:opacity-50 p-4 rounded text-center font-bold"
                                >
                                    Generate Phrases (EN)
                                </button>
                                <button
                                    onClick={() => handleGenerate('PHRASES', 'el')}
                                    disabled={status?.isRunning || isLoading}
                                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 p-4 rounded text-center font-bold"
                                >
                                    Generate Phrases (EL)
                                </button>
                                <button
                                    onClick={() => handleGenerate('QUESTIONS', 'en')}
                                    disabled={status?.isRunning || isLoading}
                                    className="bg-green-800 hover:bg-green-900 disabled:opacity-50 p-4 rounded text-center font-bold"
                                >
                                    Generate Questions (EN)
                                </button>
                                <button
                                    onClick={() => handleGenerate('QUESTIONS', 'el')}
                                    disabled={status?.isRunning || isLoading}
                                    className="bg-blue-800 hover:bg-blue-900 disabled:opacity-50 p-4 rounded text-center font-bold"
                                >
                                    Generate Questions (EL)
                                </button>
                            </div>

                            <div className="border-t border-gray-700 pt-4 mt-4">
                                <button
                                    onClick={handleClearCache}
                                    className="w-full bg-red-900 hover:bg-red-700 p-3 rounded text-red-200 text-sm"
                                >
                                    DANGER: Clear GCS Cache
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
                        <h2 className="text-xl font-bold mb-4">System Stats</h2>
                        <div className="space-y-2">
                            <div className="flex justify-between bg-gray-700 p-3 rounded">
                                <span>Server Status</span>
                                <span className={status ? "text-green-400" : "text-red-400"}>
                                    {status ? "Online" : "Offline / Connecting..."}
                                </span>
                            </div>
                            <div className="flex justify-between bg-gray-700 p-3 rounded">
                                <span>Job Running</span>
                                <span>{status?.isRunning ? 'YES' : 'NO'}</span>
                            </div>
                            <div className="flex justify-between bg-gray-700 p-3 rounded border-l-4 border-yellow-500">
                                <span>Total Cache Hits (Skipped)</span>
                                <span className="text-yellow-400 font-bold">{status?.hits || 0}</span>
                            </div>
                            <div className="flex justify-between bg-gray-700 p-3 rounded">
                                <span>Last Job Success (New)</span>
                                <span className="text-green-400">{status?.success || 0}</span>
                            </div>
                            <div className="flex justify-between bg-gray-700 p-3 rounded">
                                <span>Last Job Failed</span>
                                <span className="text-red-400">{status?.failed || 0}</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {tab === 'PROGRESS' && (
                <div className="bg-black p-4 rounded-lg font-mono text-sm h-96 overflow-y-auto border border-gray-700">
                    {logs.map((log, i) => (
                        <div key={i} className="mb-1 text-green-400">{`> ${log}`}</div>
                    ))}
                    {status?.isRunning && (
                        <div className="animate-pulse text-yellow-500">{`> Processing item ${status.current}...`}</div>
                    )}
                    {!status?.isRunning && (
                        <div className="text-gray-500">{`> Idle.`}</div>
                    )}
                </div>
            )}

            {tab === 'FAILURES' && (
                <div className="bg-gray-800 p-6 rounded-lg">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold flex items-center">
                            Failed Generations
                            <span className="ml-3 bg-red-600 text-white text-xs px-2 py-1 rounded-full">{failures.length}</span>
                        </h2>
                        <button
                            onClick={handleRetry}
                            disabled={failures.length === 0 || status?.isRunning}
                            className="bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 px-4 py-2 rounded font-bold"
                        >
                            Retry All Failed
                        </button>
                    </div>

                    <div className="mb-4 text-right">
                        <button
                            onClick={handleClearFailures}
                            disabled={failures.length === 0}
                            className="text-red-400 hover:text-red-300 text-sm underline disabled:opacity-50"
                        >
                            Clear List
                        </button>
                    </div>

                    {failures.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">No known failures. Great job!</div>
                    ) : (
                        <div className="space-y-2">
                            {failures.map((fail, i) => (
                                <div key={i} className="bg-gray-700 p-3 rounded flex justify-between items-center group">
                                    <div>
                                        <div className="font-bold text-white">{fail.text}</div>
                                        <div className="text-xs text-gray-400">{fail.language} • {fail.error}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
