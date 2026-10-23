import React, { useState, useEffect } from 'react';
import { X, Package, Server, ExternalLink, Loader } from 'lucide-react';
import { GITHUB_REPO } from '../constants';
import packageJson from '../package.json';

export interface GitHubRelease {
    id: number;
    tag_name: string;
    name: string;
    body: string;
    published_at: string;
    html_url: string;
}

export interface ChangelogPreviewData {
    serverVersion?: string;
    releases?: GitHubRelease[];
    loading?: boolean;
    error?: string | null;
}

interface ChangelogModalProps {
    isOpen: boolean;
    onClose: () => void;
    serverUrl: string;
    /** Design-lab only: deterministic data instead of network fetches. */
    previewData?: ChangelogPreviewData;
}

export const ChangelogModal: React.FC<ChangelogModalProps> = ({ isOpen, onClose, serverUrl, previewData }) => {
    const [serverVersion, setServerVersion] = useState<string>(previewData?.serverVersion ?? 'Loading...');
    const [releases, setReleases] = useState<GitHubRelease[]>(previewData?.releases ?? []);
    const [loading, setLoading] = useState(previewData?.loading ?? true);
    const [error, setError] = useState<string | null>(previewData?.error ?? null);

    const clientVersion = packageJson.version;

    useEffect(() => {
        if (!isOpen) return;

        if (previewData) {
            setServerVersion(previewData.serverVersion ?? 'Unknown');
            setReleases(previewData.releases ?? []);
            setLoading(previewData.loading ?? false);
            setError(previewData.error ?? null);
            return;
        }

        const fetchData = async () => {
            setLoading(true);
            setError(null);

            try {
                // Fetch server version
                try {
                    const versionResponse = await fetch(`${serverUrl}/api/version`);
                    if (versionResponse.ok) {
                        const versionData = await versionResponse.json();
                        setServerVersion(versionData.version);
                    } else {
                        setServerVersion('Unknown');
                    }
                } catch (versionError) {
                    console.error('Error fetching server version:', versionError);
                    setServerVersion('Unknown');
                }

                // Fetch GitHub releases
                const releasesResponse = await fetch(
                    `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=10`
                );
                if (releasesResponse.ok) {
                    const releasesData = await releasesResponse.json();
                    setReleases(releasesData);
                } else {
                    throw new Error('Failed to fetch changelog');
                }
            } catch (err) {
                console.error('Error fetching changelog:', err);
                setError('Failed to load changelog. Please check your connection.');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [isOpen, serverUrl, previewData]);

    if (!isOpen) return null;

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <div className="w-full max-w-3xl max-h-[90vh] bg-gradient-to-br from-indigo-900/95 via-purple-900/95 to-pink-900/95 rounded-3xl border border-white/20 shadow-2xl overflow-hidden flex flex-col">
                {/* Header */}
                <div className="p-6 border-b border-white/20 flex items-center justify-between bg-black/20">
                    <h2 className="text-2xl font-black text-white uppercase tracking-tight">Changelog</h2>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                        aria-label="Close"
                    >
                        <X className="w-6 h-6 text-white" />
                    </button>
                </div>

                {/* Version Info */}
                <div className="p-6 bg-black/20 border-b border-white/10">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white/10 rounded-xl p-4 border border-white/20">
                            <div className="flex items-center gap-2 mb-2">
                                <Package className="w-5 h-5 text-blue-400" />
                                <span className="text-xs font-bold text-white/60 uppercase tracking-wider">Client Version</span>
                            </div>
                            <div className="text-2xl font-black text-white">{clientVersion}</div>
                        </div>
                        <div className="bg-white/10 rounded-xl p-4 border border-white/20">
                            <div className="flex items-center gap-2 mb-2">
                                <Server className="w-5 h-5 text-green-400" />
                                <span className="text-xs font-bold text-white/60 uppercase tracking-wider">Server Version</span>
                            </div>
                            <div className="text-2xl font-black text-white">{serverVersion}</div>
                        </div>
                    </div>
                </div>

                {/* Releases */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {loading && (
                        <div className="flex items-center justify-center py-12">
                            <Loader className="w-8 h-8 text-white animate-spin" />
                        </div>
                    )}

                    {error && (
                        <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-4 text-white">
                            <p className="font-bold">{error}</p>
                        </div>
                    )}

                    {!loading && !error && releases.length === 0 && (
                        <div className="text-center text-white/60 py-12">
                            <p className="font-bold">No releases found.</p>
                        </div>
                    )}

                    {!loading && !error && releases.map((release) => (
                        <div
                            key={release.id}
                            className="bg-white/10 backdrop-blur-md rounded-xl p-5 border border-white/20 hover:border-white/40 transition-all"
                        >
                            <div className="flex items-start justify-between mb-3">
                                <div>
                                    <h3 className="text-xl font-black text-white mb-1">
                                        {release.name || release.tag_name}
                                    </h3>
                                    <div className="flex items-center gap-3 text-sm text-white/60">
                                        <span className="font-mono bg-white/10 px-2 py-1 rounded">
                                            {release.tag_name}
                                        </span>
                                        <span>{formatDate(release.published_at)}</span>
                                    </div>
                                </div>
                                <a
                                    href={release.html_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                                    title="View on GitHub"
                                >
                                    <ExternalLink className="w-4 h-4 text-white" />
                                </a>
                            </div>
                            {release.body && (
                                <div className="text-white/80 text-sm prose prose-invert max-w-none">
                                    <pre className="whitespace-pre-wrap font-sans">{release.body}</pre>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
