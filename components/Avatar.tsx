
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { AVATAR_COLORS } from '../constants';
import { Expression } from '../types';

interface AvatarProps {
    seed: string;
    size?: number;
    className?: string;
    expression?: Expression;
    speaking?: boolean;
}

const HAIR_COLORS = [
    '#090807', '#2C1608', '#714130', '#E6CEA8', '#A52A2A', '#DCDCDC', '#FF4081', '#3F51B5',
    '#2E7D32', '#F57F17', '#6A1B9A', '#1565C0', '#C62828', '#AD1457', '#00695C', '#5D4037'
];
const SKIN_TONES = [
    '#FFC107', '#FFB74D', '#FF8A65', '#A1887F', '#E57373', '#BA68C8', '#4DD0E1', '#81C784',
    '#FFD54F', '#90CAF9', '#A5D6A7', '#F48FB1', '#CE93D8', '#BCAAA4', '#80CBC4', '#E6EE9C'
];

export const Avatar: React.FC<AvatarProps> = ({ seed, size = 100, className = '', expression = 'NEUTRAL', speaking = false }) => {
    const [blinking, setBlinking] = useState(false);
    const [gaze, setGaze] = useState({ x: 0, y: 0 });
    const [mouthState, setMouthState] = useState(0); // 0 = closed, 1 = open
    const containerRef = useRef<HTMLDivElement>(null);

    // --- GENETICS ---
    const features = useMemo(() => {
        let hash = 0;
        for (let i = 0; i < seed.length; i++) {
            hash = seed.charCodeAt(i) + ((hash << 5) - hash);
        }

        // Helper to pull genes deterministically
        const getGene = (shift: number, mod: number) => Math.abs(hash >> shift) % mod;

        return {
            skinColor: SKIN_TONES[getGene(0, SKIN_TONES.length)],
            bodyShape: getGene(1, 3), // 0=Circle, 1=Squircle, 2=Peanut
            eyeSpacing: (getGene(2, 8)) - 4, // -4 to 4
            eyeSize: getGene(3, 3),
            mouthType: getGene(4, 5),
            hairType: getGene(5, 8), // 0=Bald, 1=Spiky, 2=Bob, 3=Afro, 4=Long, 5=Mohawk, 6=Crazy, 7=Ponytail
            hairColor: HAIR_COLORS[getGene(6, HAIR_COLORS.length)],
            noseType: getGene(7, 4), // 0=None, 1=Button, 2=Long, 3=Triangle
            cheekType: getGene(8, 4), // 0=None, 1=Rosy, 2=Freckles, 3=Spiral
            accessory: getGene(9, 6), // 0-2=None, 3=Glasses, 4=Patch, 5=Monocle
            facialHair: getGene(10, 5) // 0-1=None, 2=Stubble, 3=Mustache, 4=Goatee
        };
    }, [seed]);

    // --- BEHAVIOR LOOPS ---
    useEffect(() => {
        // 1. Blinking Loop
        let blinkTimeout: number;
        const triggerBlink = () => {
            setBlinking(true);
            setTimeout(() => setBlinking(false), 150);
            const nextBlink = Math.random() * 3000 + 2000 + (expression === 'SHOCKED' ? 4000 : 0);
            blinkTimeout = window.setTimeout(triggerBlink, nextBlink);
        };
        blinkTimeout = window.setTimeout(triggerBlink, Math.random() * 2000);

        // 2. Gaze Loop (Looking Around)
        let gazeTimeout: number;
        const moveEyes = () => {
            if (expression === 'SHOCKED') {
                setGaze({ x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6 });
                gazeTimeout = window.setTimeout(moveEyes, 100);
            } else if (expression === 'SMUG') {
                setGaze({ x: 0, y: 0 });
                gazeTimeout = window.setTimeout(moveEyes, 2000);
            } else if (expression === 'THINKING') {
                setGaze({ x: 0, y: -5 }); // Look up
                gazeTimeout = window.setTimeout(moveEyes, 2000);
            } else if (expression === 'ANGRY') {
                setGaze({ x: 0, y: 2 }); // Look intense
                gazeTimeout = window.setTimeout(moveEyes, 3000);
            } else {
                const r = Math.random();
                if (r < 0.7) {
                    setGaze({ x: (Math.random() - 0.5) * 12, y: (Math.random() - 0.5) * 8 });
                } else {
                    setGaze({ x: 0, y: 0 });
                }
                gazeTimeout = window.setTimeout(moveEyes, Math.random() * 2000 + 1000);
            }
        };
        moveEyes();

        // 3. Speaking Loop (Mouth Animation)
        let speakInterval: number;
        if (speaking) {
            speakInterval = window.setInterval(() => {
                setMouthState(prev => (prev === 0 ? 1 : 0));
            }, 150); // Fast toggle
        } else {
            setMouthState(0);
        }

        return () => {
            clearTimeout(blinkTimeout);
            clearTimeout(gazeTimeout);
            if (speakInterval) clearInterval(speakInterval);
        };
    }, [expression, speaking]);


    // --- COMPONENT PARTS ---

    const getAnimationClass = () => {
        switch (expression) {
            case 'HAPPY': return 'animate-bounce-subtle';
            case 'SHOCKED': return 'animate-shiver';
            case 'THINKING': return 'animate-sway';
            case 'SMUG': return 'animate-float-smug';
            case 'SAD': return 'animate-squash-sad';
            case 'ANGRY': return 'animate-shake-angry';
            default: return 'animate-float';
        }
    };

    const BodyShape = () => {
        const { bodyShape, skinColor } = features;
        const stroke = "black";
        const strokeWidth = "3";

        switch (bodyShape) {
            case 2: // Peanut / Blob
                return <path d="M 30 20 Q 10 20 10 50 Q 10 80 30 90 L 70 90 Q 90 80 90 50 Q 90 20 70 20 Z" fill={skinColor} stroke={stroke} strokeWidth={strokeWidth} />;
            case 1: // Squircle
                return <rect x="10" y="10" width="80" height="80" rx="25" fill={skinColor} stroke={stroke} strokeWidth={strokeWidth} />;
            default: // Circle
                return <circle cx="50" cy="50" r="45" fill={skinColor} stroke={stroke} strokeWidth={strokeWidth} />;
        }
    };

    const HairBack = () => {
        const { hairType, hairColor } = features;
        if (hairType === 3) // Afro Back
            return <circle cx="50" cy="50" r="55" fill={hairColor} stroke="black" strokeWidth="3" />;
        if (hairType === 4) // Long Back
            return <path d="M 20 50 L 10 95 L 90 95 L 80 50 Z" fill={hairColor} stroke="black" strokeWidth="3" />;
        if (hairType === 7) // Ponytail
            return <circle cx="85" cy="50" r="15" fill={hairColor} stroke="black" strokeWidth="3" />;
        return null;
    };

    const HairFront = () => {
        const { hairType, hairColor } = features;
        const stroke = "black";
        const strokeWidth = "2";

        // If shocked or angry, hair logic
        const transform = expression === 'SHOCKED' ? "translate(0, -5)" : "";

        switch (hairType) {
            case 1: // Spiky
                return <path d="M 20 30 L 30 10 L 40 30 L 50 5 L 60 30 L 70 10 L 80 30" fill={hairColor} stroke={stroke} strokeWidth={strokeWidth} transform={transform} />;
            case 2: // Bob
                return <path d="M 15 30 Q 50 5 85 30 L 85 60 Q 85 70 75 60 L 75 30 Q 50 35 25 30 L 25 60 Q 15 70 15 60 Z" fill={hairColor} stroke={stroke} strokeWidth={strokeWidth} />;
            case 3: // Afro Front
                return <path d="M 15 40 Q 50 10 85 40" fill="none" stroke={hairColor} strokeWidth="18" strokeLinecap="round" />;
            case 4: // Long Front (Bangs)
                return <path d="M 20 30 Q 50 35 80 30" fill="none" stroke={hairColor} strokeWidth="10" strokeLinecap="round" />;
            case 5: // Mohawk
                return <path d="M 45 5 L 55 5 L 52 40 L 48 40 Z" fill={hairColor} stroke={stroke} strokeWidth={strokeWidth} transform={transform} />;
            case 6: // Crazy
                return (
                    <g transform={transform}>
                        <path d="M 10 40 Q 0 10 30 20" fill="none" stroke={hairColor} strokeWidth="5" strokeLinecap="round" />
                        <path d="M 90 40 Q 100 10 70 20" fill="none" stroke={hairColor} strokeWidth="5" strokeLinecap="round" />
                        <path d="M 40 20 L 50 0 L 60 20" fill="none" stroke={hairColor} strokeWidth="5" strokeLinecap="round" />
                    </g>
                );
            default: return null;
        }
    };

    const Eyebrows = () => {
        const stroke = "black";
        const width = "3";

        switch (expression) {
            case 'SHOCKED':
                return (
                    <g stroke={stroke} strokeWidth={width} fill="none" strokeLinecap="round">
                        <path d="M 20 20 Q 30 5 40 20" />
                        <path d="M 60 20 Q 70 5 80 20" />
                    </g>
                );
            case 'SAD':
                return (
                    <g stroke={stroke} strokeWidth={width} fill="none" strokeLinecap="round">
                        <path d="M 15 32 L 40 28" />
                        <path d="M 60 28 L 85 32" />
                    </g>
                );
            case 'SMUG':
                return (
                    <g stroke={stroke} strokeWidth={width} fill="none" strokeLinecap="round">
                        <path d="M 20 30 L 40 35" />
                        <path d="M 60 30 Q 70 20 80 30" />
                    </g>
                );
            case 'THINKING':
                return (
                    <g stroke={stroke} strokeWidth={width} fill="none" strokeLinecap="round">
                        <path d="M 20 35 L 40 35" />
                        <path d="M 60 25 Q 70 15 80 25" />
                    </g>
                );
            case 'ANGRY':
                return (
                    <g stroke={stroke} strokeWidth={width} fill="none" strokeLinecap="round">
                        <path d="M 20 25 L 45 35" />
                        <path d="M 80 25 L 55 35" />
                    </g>
                );
            default: // Neutral
                return (
                    <g stroke={stroke} strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.6">
                        <path d="M 25 32 Q 32 30 40 32" />
                        <path d="M 60 32 Q 68 30 75 32" />
                    </g>
                );
        }
    };

    const EyeBalls = () => {
        // 1. Blinking State (Closed Eyes)
        if (blinking) {
            return (
                <g stroke="black" strokeWidth="3" strokeLinecap="round">
                    <line x1="25" y1="45" x2="45" y2="45" />
                    <line x1="55" y1="45" x2="75" y2="45" />
                </g>
            );
        }

        // 2. Happy Eyes (Squint/Curve)
        if (expression === 'HAPPY') {
            return (
                <g stroke="black" strokeWidth="4" fill="none" strokeLinecap="round">
                    <path d="M 25 50 Q 35 40 45 50" />
                    <path d="M 55 50 Q 65 40 75 50" />
                </g>
            );
        }

        // 3. Open Eyes
        // Calculate eye positions
        const r = features.eyeSize === 0 ? 8 : (features.eyeSize === 1 ? 11 : 6);
        const pupilR = expression === 'SHOCKED' ? 2 : Math.max(2, r / 2.5);

        return (
            <g>
                <g transform={`translate(${features.eyeSpacing}, 0)`}>
                    <circle cx="35" cy="48" r={r} fill="white" stroke="black" strokeWidth="2" />
                    <circle cx="65" cy="48" r={r} fill="white" stroke="black" strokeWidth="2" />

                    {/* Eyelids for Angry */}
                    {expression === 'ANGRY' && (
                        <g fill={features.skinColor} stroke="black" strokeWidth="1">
                            <path d="M 20 35 L 50 48 L 50 30 Z" />
                            <path d="M 80 35 L 50 48 L 50 30 Z" />
                        </g>
                    )}

                    {/* Pupils with Gaze */}
                    <g transform={`translate(${gaze.x}, ${gaze.y})`}>
                        <circle cx="35" cy="48" r={pupilR} fill="black" />
                        <circle cx="65" cy="48" r={pupilR} fill="black" />
                        <circle cx="37" cy="46" r={pupilR / 2} fill="white" opacity="0.7" />
                        <circle cx="67" cy="46" r={pupilR / 2} fill="white" opacity="0.7" />
                    </g>
                </g>
            </g>
        );
    };

    const Accessories = () => {
        const r = features.eyeSize === 0 ? 8 : (features.eyeSize === 1 ? 11 : 6);

        // Glasses
        if (features.accessory === 3) {
            return (
                <g stroke="black" strokeWidth="2" fill="rgba(255,255,255,0.3)">
                    <circle cx="35" cy="48" r={r + 6} strokeWidth="3" />
                    <circle cx="65" cy="48" r={r + 6} strokeWidth="3" />
                    <line x1="48" y1="48" x2="52" y2="48" strokeWidth="3" />
                    <line x1="20" y1="48" x2="10" y2="45" />
                    <line x1="80" y1="48" x2="90" y2="45" />
                </g>
            );
        }
        // Eye Patch (Covers Left Eye)
        if (features.accessory === 4) {
            return (
                <g>
                    <path d="M 20 40 L 50 60" stroke="black" strokeWidth="2" />
                    <circle cx="35" cy="48" r={r + 2} fill="black" />
                </g>
            );
        }
        // Monocle (Right Eye)
        if (features.accessory === 5) {
            return (
                <g>
                    <circle cx="65" cy="48" r={r + 4} fill="rgba(200,255,255,0.3)" stroke="gold" strokeWidth="2" />
                    <path d="M 65 60 Q 65 80 70 90" fill="none" stroke="gold" strokeWidth="1" />
                </g>
            );
        }
        return null;
    };

    const Nose = () => {
        const { noseType } = features;
        const color = "rgba(0,0,0,0.1)"; // Shadowy nose

        switch (noseType) {
            case 1: return <circle cx="50" cy="60" r="4" fill={color} />;
            case 2: return <path d="M 50 55 L 45 65 L 55 65 Z" fill={color} />; // Triangle
            case 3: return <path d="M 50 50 L 50 65 L 58 65" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" opacity="0.3" />; // L shape
            default: return null;
        }
    };

    const Cheeks = () => {
        const { cheekType } = features;
        if (cheekType === 1) // Rosy
            return (
                <g fill="#FF0000" opacity="0.1">
                    <circle cx="20" cy="60" r="8" />
                    <circle cx="80" cy="60" r="8" />
                </g>
            );
        if (cheekType === 2) // Freckles
            return (
                <g fill="rgba(100,50,0,0.2)">
                    <circle cx="20" cy="60" r="2" />
                    <circle cx="25" cy="58" r="1.5" />
                    <circle cx="18" cy="64" r="2" />
                    <circle cx="80" cy="60" r="2" />
                    <circle cx="75" cy="58" r="1.5" />
                    <circle cx="82" cy="64" r="2" />
                </g>
            );
        if (cheekType === 3) // Spiral
            return (
                <g stroke="#F06292" strokeWidth="1" fill="none" opacity="0.4">
                    <path d="M 20 60 Q 25 55 20 50 Q 15 55 20 60" />
                    <path d="M 80 60 Q 85 55 80 50 Q 75 55 80 60" />
                </g>
            );
        return null;
    };

    const FacialHair = () => {
        const { facialHair, hairColor } = features;
        if (facialHair === 2) // Stubble
            return <path d="M 30 70 Q 50 90 70 70" fill="none" stroke="black" strokeWidth="1" strokeDasharray="2,2" opacity="0.5" />;
        if (facialHair === 3) // Mustache
            return <path d="M 35 70 Q 50 60 65 70 Q 50 75 35 70" fill={hairColor} stroke="black" strokeWidth="1" />;
        if (facialHair === 4) // Goatee
            return <path d="M 45 80 L 50 90 L 55 80" fill={hairColor} stroke="black" strokeWidth="1" />;
        return null;
    };

    const Mouth = () => {
        if (speaking && mouthState === 1) {
            // Open talking mouth
            return <ellipse cx="50" cy="78" rx="8" ry="8" fill="black" />;
        }

        if (expression === 'SHOCKED') return <ellipse cx="50" cy="78" rx="8" ry="12" fill="black" />;
        if (expression === 'HAPPY') return <path d="M 30 75 Q 50 90 70 75" fill="#FFFFFF" stroke="black" strokeWidth="2" />;
        if (expression === 'SAD') return <path d="M 35 85 Q 50 75 65 85" fill="none" stroke="black" strokeWidth="3" strokeLinecap="round" />;
        if (expression === 'SMUG') return <path d="M 40 78 Q 50 78 60 75" fill="none" stroke="black" strokeWidth="3" strokeLinecap="round" />;
        if (expression === 'ANGRY') return <path d="M 40 85 Q 50 75 60 85" fill="none" stroke="black" strokeWidth="3" strokeLinecap="round" />;

        switch (features.mouthType) {
            case 0: return <line x1="42" y1="78" x2="58" y2="78" stroke="black" strokeWidth="3" strokeLinecap="round" />;
            case 1: return <circle cx="50" cy="78" r="4" fill="black" />;
            case 2: return <path d="M 40 78 Q 50 82 60 78" fill="none" stroke="black" strokeWidth="3" strokeLinecap="round" />;
            case 3: return <rect x="42" y="76" width="16" height="4" rx="1" fill="white" stroke="black" strokeWidth="1" />;
            default: return <path d="M 45 80 Q 50 75 55 80" fill="none" stroke="black" strokeWidth="2" />; // Pucker
        }
    };

    const Particles = () => {
        // SVG Particles
        if (expression === 'SHOCKED') {
            return (
                <g fill="#4FC3F7" className="animate-pulse">
                    <path d="M 90 20 Q 95 10 100 20 A 5 5 0 1 1 90 20" />
                    <path d="M 10 20 Q 5 10 0 20 A 5 5 0 1 1 10 20" />
                </g>
            );
        }
        if (expression === 'THINKING') {
            return <text x="85" y="30" fontSize="30" fontWeight="bold" fill="#000" className="animate-question">?</text>;
        }
        if (expression === 'SMUG') {
            return (
                <g stroke="#FFA000" strokeWidth="3" className="animate-spin-slow" opacity="0.8">
                    <line x1="85" y1="15" x2="95" y2="25" />
                    <line x1="95" y1="15" x2="85" y2="25" />
                </g>
            );
        }
        if (expression === 'ANGRY') {
            return (
                <g stroke="#D32F2F" strokeWidth="4" opacity="0.8">
                    <path d="M 10 10 L 25 25" />
                    <path d="M 25 10 L 10 25" />
                    <path d="M 80 10 L 95 25" />
                    <path d="M 95 10 L 80 25" />
                </g>
            );
        }
        return null;
    };

    return (
        <div
            ref={containerRef}
            className={`relative select-none ${className}`}
            style={{ width: size, height: size }}
        >
            {/* Styles for physics animations */}
            <style>{`
        .animate-bounce-subtle { animation: bounce-subtle 3.2s infinite alternate ease-in-out; }
        .animate-shiver { animation: shiver 0.6s infinite; }
        .animate-shake-angry { animation: shiver 0.45s infinite; }
        .animate-float { animation: float 5.5s infinite ease-in-out; }
        .animate-float-smug { animation: float 6.5s infinite ease-in-out reverse; }
        .animate-sway { animation: sway 4s infinite ease-in-out; }
        .animate-squash-sad { transform-origin: bottom; animation: squash 4s infinite ease-in-out; }
        .animate-question { animation: question 3.2s infinite ease-in-out; }
        
        @keyframes bounce-subtle { from { transform: translateY(0); } to { transform: translateY(-2%); } }
        @keyframes shiver { 0% { transform: translate(0.5px, 0.5px); } 50% { transform: translate(-0.5px, -0.5px); } 100% { transform: translate(0.5px, -0.5px); } }
        @keyframes float { 0% { transform: translateY(0); } 50% { transform: translateY(-1.5%); } 100% { transform: translateY(0); } }
        @keyframes sway { 0% { transform: rotate(-1deg); } 50% { transform: rotate(1deg); } 100% { transform: rotate(-1deg); } }
        @keyframes squash { 0% { transform: scaleY(1); } 50% { transform: scaleY(0.98); } 100% { transform: scaleY(1); } }
        @keyframes question { 0% { transform: translateY(0); } 50% { transform: translateY(-3px); } 100% { transform: translateY(0); } }
      `}</style>

            {/* Main Avatar SVG */}
            <div className={`w-full h-full ${getAnimationClass()} transition-transform duration-500`}>
                <svg viewBox="0 0 100 100" className="w-full h-full overflow-visible drop-shadow-lg">
                    {/* Layer 1: Back Hair */}
                    <HairBack />

                    {/* Layer 2: Body/Face Shape */}
                    <BodyShape />

                    {/* Layer 3: Face Details */}
                    <Cheeks />
                    <Nose />
                    <Eyebrows />

                    {/* Layer 4: Eyes and Accessories (Split for blink fix) */}
                    <EyeBalls />
                    <Accessories />

                    <FacialHair />
                    <Mouth />

                    {/* Layer 5: Front Hair */}
                    <HairFront />

                    {/* Layer 6: Particles */}
                    <Particles />
                </svg>
            </div>
        </div>
    );
};
