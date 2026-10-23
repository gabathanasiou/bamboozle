import { DesignerConfig, GameView, ScreenGroup, ScreenId, TextLength, ViewportConfig } from './types';

export interface ScreenDefinition {
    id: ScreenId;
    label: string;
    group: ScreenGroup;
    kind: 'app' | 'join' | 'game';
    icon: string;
    hint: string;
}

export const SCREENS: ScreenDefinition[] = [
    { id: 'home', label: 'Home', group: 'App', kind: 'app', icon: 'Home', hint: 'Home screen + room manager' },
    { id: 'settings', label: 'Settings', group: 'App', kind: 'app', icon: 'Settings', hint: 'Settings + changelog' },
    { id: 'offline', label: 'Offline', group: 'App', kind: 'app', icon: 'WifiOff', hint: 'Connection lost screen' },
    { id: 'admin', label: 'Admin', group: 'App', kind: 'app', icon: 'Wrench', hint: 'TTS admin console' },
    { id: 'join', label: 'Join', group: 'Join', kind: 'join', icon: 'LogIn', hint: 'Code / name / saved session' },
    { id: 'lobby', label: 'Lobby', group: 'Game', kind: 'game', icon: 'Users', hint: 'Ready up + start' },
    { id: 'category', label: 'Category', group: 'Game', kind: 'game', icon: 'Shapes', hint: 'Category roulette' },
    { id: 'intro', label: 'Intro', group: 'Game', kind: 'game', icon: 'Megaphone', hint: 'Question read-out' },
    { id: 'writing', label: 'Writing', group: 'Game', kind: 'game', icon: 'PenLine', hint: 'Lie input / submitted' },
    { id: 'voting', label: 'Voting', group: 'Game', kind: 'game', icon: 'Vote', hint: 'Spot the truth' },
    { id: 'reveal', label: 'Reveal', group: 'Game', kind: 'game', icon: 'Eye', hint: 'Card / voters / author' },
    { id: 'leaderboard', label: 'Leaderboard', group: 'Game', kind: 'game', icon: 'Trophy', hint: 'Scores + ranks' },
    { id: 'gameOver', label: 'Game Over', group: 'Game', kind: 'game', icon: 'Crown', hint: 'Final scores + restart' },
];

export const SCREEN_BY_ID: Record<ScreenId, ScreenDefinition> = Object.fromEntries(
    SCREENS.map((screen) => [screen.id, screen])
) as Record<ScreenId, ScreenDefinition>;

export const isAppScreen = (screen: ScreenId) => SCREEN_BY_ID[screen].kind === 'app';
export const isGameScreen = (screen: ScreenId) => SCREEN_BY_ID[screen].kind === 'game';

export interface ViewOption {
    value: GameView;
    label: string;
    mode: 'online' | 'classic';
    role: 'host' | 'player' | 'audience' | 'unjoined';
}

export const VIEW_OPTIONS: ViewOption[] = [
    { value: 'online-host', label: 'Online · Host', mode: 'online', role: 'host' },
    { value: 'online-player', label: 'Online · Player', mode: 'online', role: 'player' },
    { value: 'online-audience', label: 'Online · Audience', mode: 'online', role: 'audience' },
    { value: 'classic-host', label: 'Classic · Host', mode: 'classic', role: 'host' },
    { value: 'classic-player', label: 'Classic · Player', mode: 'classic', role: 'player' },
    { value: 'classic-audience', label: 'Classic · Audience', mode: 'classic', role: 'audience' },
];

export const VIEW_BY_VALUE: Record<GameView, ViewOption> = Object.fromEntries(
    VIEW_OPTIONS.map((view) => [view.value, view])
) as Record<GameView, ViewOption>;

export type ViewportGroup = 'iPhone' | 'iPad' | 'Mac' | 'Desktop' | 'Android' | 'TV';

export interface ViewportPreset extends ViewportConfig {
    label: string;
    group: ViewportGroup;
    kind: 'phone' | 'tablet' | 'desktop' | 'tv';
}

/**
 * Logical CSS viewports (Safari Responsive Design / Apple + Android current
 * device sizes). Kept in sync with the design-lab dropdown groups below.
 */
export const VIEWPORTS: ViewportPreset[] = [
    // iPhone (CSS ports, not panel pixels)
    { preset: 'iphone-se', label: 'iPhone SE (3rd gen)', width: 375, height: 667, group: 'iPhone', kind: 'phone' },
    { preset: 'iphone-13-mini', label: 'iPhone 13 mini', width: 375, height: 812, group: 'iPhone', kind: 'phone' },
    { preset: 'iphone-17e', label: 'iPhone 17e', width: 390, height: 844, group: 'iPhone', kind: 'phone' },
    { preset: 'iphone-14-pro', label: 'iPhone 14 / 15 / 16', width: 393, height: 852, group: 'iPhone', kind: 'phone' },
    { preset: 'iphone-16-pro', label: 'iPhone 16 Pro / 17', width: 402, height: 874, group: 'iPhone', kind: 'phone' },
    { preset: 'iphone-18-pro', label: 'iPhone 18 Pro', width: 402, height: 873, group: 'iPhone', kind: 'phone' },
    { preset: 'iphone-14-pro-max', label: 'iPhone 14 / 15 Pro Max', width: 430, height: 932, group: 'iPhone', kind: 'phone' },
    { preset: 'iphone-16-pro-max', label: 'iPhone 16 / 18 Pro Max', width: 440, height: 956, group: 'iPhone', kind: 'phone' },
    { preset: 'iphone-17-air', label: 'iPhone 17 Air', width: 420, height: 912, group: 'iPhone', kind: 'phone' },
    { preset: 'iphone-duo-folded', label: 'iPhone Duo (folded)', width: 466, height: 678, group: 'iPhone', kind: 'phone' },
    { preset: 'iphone-duo-unfolded', label: 'iPhone Duo (unfolded)', width: 890, height: 626, group: 'iPhone', kind: 'phone' },

    // iPad
    { preset: 'ipad-mini', label: 'iPad mini', width: 744, height: 1133, group: 'iPad', kind: 'tablet' },
    { preset: 'ipad-air', label: 'iPad / iPad Air 11', width: 820, height: 1180, group: 'iPad', kind: 'tablet' },
    { preset: 'ipad-pro-11', label: 'iPad Pro 11', width: 834, height: 1194, group: 'iPad', kind: 'tablet' },
    { preset: 'ipad-pro-13', label: 'iPad Pro 13', width: 1024, height: 1366, group: 'iPad', kind: 'tablet' },

    // Mac (screen points / logical resolution)
    { preset: 'macbook-air-13', label: 'MacBook Air 13', width: 1440, height: 900, group: 'Mac', kind: 'desktop' },
    { preset: 'macbook-pro-14', label: 'MacBook Pro 14', width: 1512, height: 982, group: 'Mac', kind: 'desktop' },
    { preset: 'macbook-pro-16', label: 'MacBook Pro 16', width: 1728, height: 1117, group: 'Mac', kind: 'desktop' },
    { preset: 'imac-24', label: 'iMac 24', width: 2240, height: 1260, group: 'Mac', kind: 'desktop' },
    { preset: 'studio-display', label: 'Studio Display', width: 2560, height: 1440, group: 'Mac', kind: 'desktop' },
    { preset: 'pro-display-xdr', label: 'Pro Display XDR', width: 3008, height: 1692, group: 'Mac', kind: 'desktop' },

    // Generic desktop / TV
    { preset: 'desktop-720', label: 'Desktop 1280×720', width: 1280, height: 720, group: 'Desktop', kind: 'desktop' },
    { preset: 'laptop-1366', label: 'Laptop 1366×768', width: 1366, height: 768, group: 'Desktop', kind: 'desktop' },
    { preset: 'desktop-1080', label: 'Desktop 1920×1080', width: 1920, height: 1080, group: 'Desktop', kind: 'desktop' },
    { preset: 'desktop-1440', label: 'Desktop 2560×1440', width: 2560, height: 1440, group: 'Desktop', kind: 'desktop' },
    { preset: 'desktop-4k', label: 'Desktop 3840×2160', width: 3840, height: 2160, group: 'Desktop', kind: 'desktop' },
    { preset: 'tv-1080', label: 'TV 1080p', width: 1920, height: 1080, group: 'TV', kind: 'tv' },
    { preset: 'tv-4k', label: 'TV 4K', width: 3840, height: 2160, group: 'TV', kind: 'tv' },

    // Android
    { preset: 'pixel-7', label: 'Pixel 7', width: 412, height: 915, group: 'Android', kind: 'phone' },
    { preset: 'pixel-9', label: 'Pixel 9', width: 412, height: 923, group: 'Android', kind: 'phone' },
    { preset: 'galaxy-s24', label: 'Galaxy S24', width: 360, height: 780, group: 'Android', kind: 'phone' },
    { preset: 'galaxy-s24-ultra', label: 'Galaxy S24 Ultra', width: 384, height: 824, group: 'Android', kind: 'phone' },
    { preset: 'galaxy-tab-s9', label: 'Galaxy Tab S9', width: 800, height: 1280, group: 'Android', kind: 'tablet' },
];

export const VIEWPORT_GROUPS = (['iPhone', 'iPad', 'Mac', 'Desktop', 'Android', 'TV'] as const).map((group) => ({
    label: group,
    options: VIEWPORTS.filter((viewport) => viewport.group === group).map((viewport) => ({
        value: viewport.preset,
        label: `${viewport.label} · ${viewport.width}×${viewport.height}`,
    })),
}));

export const VIEWPORT_BY_PRESET = Object.fromEntries(
    VIEWPORTS.map((viewport) => [viewport.preset, viewport])
);

export interface CopySet {
    category: string;
    fact: string;
    answer: string;
    lies: string[];
    names: string[];
}

interface LocalizedCopy {
    short: CopySet;
    normal: CopySet;
    long: CopySet;
    extreme: CopySet;
}

const EN: LocalizedCopy = {
    short: {
        category: 'ANIMALS',
        fact: 'CATS HAVE <BLANK> LIVES.',
        answer: 'NINE',
        lies: ['SEVEN', 'ELEVEN', 'THREE', 'FIVE', 'SIX', 'TWO'],
        names: ['ALEX', 'MARIA', 'NIKOS', 'ELENI', 'GIORGOS', 'SOFIA'],
    },
    normal: {
        category: 'WEIRD HISTORY',
        fact: 'THE EIFFEL TOWER WAS ORIGINALLY SUPPOSED TO BE <BLANK> BEFORE IT BECAME A PERMANENT LANDMARK.',
        answer: 'DISMANTLED',
        lies: ['PAINTED PINK', 'MOVED TO LONDON', 'MADE OF WOOD', 'USED AS A PRISON', 'TURNED INTO A HOTEL', 'LEFT UNFINISHED'],
        names: ['ALEXANDRA', 'MAXIMILIAN', 'KATERINA', 'SEBASTIAN', 'IOANNA', 'CHRISTOS'],
    },
    long: {
        category: 'THINGS YOU NEVER KNEW ABOUT THE ANCIENT WORLD',
        fact: 'ARCHAEOLOGISTS DISCOVERED THAT THE ANCIENT ROMANS USED <BLANK> TO KEEP THEIR STREETS CLEAN, A DETAIL THAT SURPRISED HISTORIANS FOR DECADES.',
        answer: 'RUNNING WATER',
        lies: ['SALT AND VINEGAR', 'TRAINED MONKEYS', 'HOT OIL', 'BROKEN POTTERY', 'SEAWEED', 'VOLCANIC ASH'],
        names: ['ALEXANDRA THE', 'MAXIMILIANO', 'KATERINA-MARIA', 'SEBASTIANOS', 'IOANNA-SOFIA', 'CHRISTOS-JR'],
    },
    extreme: {
        category: 'THE MOST UNEXPECTED AND COMPLETELY RIDICULOUS FACTS ABOUT HUMAN HISTORY',
        fact: 'A TEAM OF RESEARCHERS AT A SMALL UNIVERSITY DISCOVERED THAT, FOR ALMOST TWO HUNDRED YEARS, THE PEOPLE OF A REMOTE ISLAND USED <BLANK> AS THEIR MAIN FORM OF CURRENCY, WHICH CAUSED A SERIES OF UNEXPECTED PROBLEMS FOR EVERY TRAVELLER WHO VISITED.',
        answer: 'DRIED FISH',
        lies: ['POLISHED SEA SHELLS', 'OLD SHIP NAILS', 'BOTTLES OF RAINWATER', 'HANDMADE WOODEN TOKENS', 'SACKS OF SALT', 'FEATHERS FROM RARE BIRDS'],
        names: ['ALEXANDRA-X', 'MAXIMILIANO', 'KATERINA-MAR', 'SEBASTIANOS', 'IOANNA-SOFIA', 'CHRISTOS-JR'],
    },
};

const EL: LocalizedCopy = {
    short: {
        category: 'ΖΩΑ',
        fact: 'ΟΙ ΓΑΤΕΣ ΕΧΟΥΝ <BLANK> ΖΩΕΣ.',
        answer: 'ΕΝΝΕΑ',
        lies: ['ΕΠΤΑ', 'ΕΝΤΕΚΑ', 'ΤΡΕΙΣ', 'ΠΕΝΤΕ', 'ΕΞΙ', 'ΔΥΟ'],
        names: ['ΑΛΕΞ', 'ΜΑΡΙΑ', 'ΝΙΚΟΣ', 'ΕΛΕΝΗ', 'ΓΙΩΡΓΟΣ', 'ΣΟΦΙΑ'],
    },
    normal: {
        category: 'ΠΕΡΙΕΡΓΗ ΙΣΤΟΡΙΑ',
        fact: 'Ο ΠΥΡΓΟΣ ΤΟΥ ΑΪΦΕΛ ΕΙΧΕ ΑΡΧΙΚΑ ΣΧΕΔΙΑΣΤΕΙ ΝΑ <BLANK> ΠΡΙΝ ΓΙΝΕΙ ΜΟΝΙΜΟ ΟΡΟΣΗΜΟ.',
        answer: 'ΔΙΑΛΥΘΕΙ',
        lies: ['ΒΑΦΤΕΙ ΡΟΖ', 'ΜΕΤΑΦΕΡΘΕΙ ΣΤΟ ΛΟΝΔΙΝΟ', 'ΓΙΝΕΙ ΑΠΟ ΞΥΛΟ', 'ΓΙΝΕΙ ΦΥΛΑΚΗ', 'ΓΙΝΕΙ ΞΕΝΟΔΟΧΕΙΟ', 'ΜΕΙΝΕΙ ΗΜΙΤΕΛΗΣ'],
        names: ['ΑΛΕΞΑΝΔΡΑ', 'ΜΑΞΙΜΙΛΙΑΝΟΣ', 'ΚΑΤΕΡΙΝΑ', 'ΣΕΒΑΣΤΙΑΝΟΣ', 'ΙΩΑΝΝΑ', 'ΧΡΗΣΤΟΣ'],
    },
    long: {
        category: 'ΠΡΑΓΜΑΤΑ ΠΟΥ ΔΕΝ ΗΞΕΡΕΣ ΓΙΑ ΤΟΝ ΑΡΧΑΙΟ ΚΟΣΜΟ',
        fact: 'ΟΙ ΑΡΧΑΙΟΛΟΓΟΙ ΑΝΑΚΑΛΥΨΑΝ ΟΤΙ ΟΙ ΑΡΧΑΙΟΙ ΡΩΜΑΙΟΙ ΧΡΗΣΙΜΟΠΟΙΟΥΣΑΝ <BLANK> ΓΙΑ ΝΑ ΚΡΑΤΟΥΝ ΤΟΥΣ ΔΡΟΜΟΥΣ ΤΟΥΣ ΚΑΘΑΡΟΥΣ, ΜΙΑ ΛΕΠΤΟΜΕΡΕΙΑ ΠΟΥ ΕΞΕΠΛΗΞΕ ΤΟΥΣ ΙΣΤΟΡΙΚΟΥΣ ΓΙΑ ΔΕΚΑΕΤΙΕΣ.',
        answer: 'ΤΡΕΧΟΥΜΕΝΟ ΝΕΡΟ',
        lies: ['ΑΛΑΤΙ ΚΑΙ ΞΙΔΙ', 'ΕΚΠΑΙΔΕΥΜΕΝΕΣ ΜΑΪΜΟΥΔΕΣ', 'ΚΑΥΤΟ ΛΑΔΙ', 'ΣΠΑΣΜΕΝΑ ΚΕΡΑΜΙΚΑ', 'ΦΥΚΙΑ', 'ΗΦΑΙΣΤΕΙΑΚΗ ΣΤΑΧΤΗ'],
        names: ['ΑΛΕΞΑΝΔΡΑ Η', 'ΜΑΞΙΜΙΛΙΑΝΟΣ', 'ΚΑΤΕΡΙΝΑ-ΜΑΡΙΑ', 'ΣΕΒΑΣΤΙΑΝΟΣ', 'ΙΩΑΝΝΑ-ΣΟΦΙΑ', 'ΧΡΗΣΤΟΣ-ΤΖΡ'],
    },
    extreme: {
        category: 'ΤΑ ΠΙΟ ΑΠΡΟΣΜΕΝΑ ΚΑΙ ΑΠΟΛΥΤΑ ΓΕΛΟΙΑ ΓΕΓΟΝΟΤΑ ΤΗΣ ΑΝΘΡΩΠΙΝΗΣ ΙΣΤΟΡΙΑΣ',
        fact: 'ΜΙΑ ΟΜΑΔΑ ΕΡΕΥΝΗΤΩΝ ΑΠΟ ΕΝΑ ΜΙΚΡΟ ΠΑΝΕΠΙΣΤΗΜΙΟ ΑΝΑΚΑΛΥΨΕ ΟΤΙ, ΓΙΑ ΣΧΕΔΟΝ ΔΙΑΚΟΣΙΑ ΧΡΟΝΙΑ, ΟΙ ΚΑΤΟΙΚΟΙ ΕΝΟΣ ΑΠΟΜΟΝΩΜΕΝΟΥ ΝΗΣΙΟΥ ΧΡΗΣΙΜΟΠΟΙΟΥΣΑΝ <BLANK> ΩΣ ΤΟ ΚΥΡΙΟ ΝΟΜΙΣΜΑ ΤΟΥΣ, ΚΑΤΙ ΠΟΥ ΔΗΜΙΟΥΡΓΗΣΕ ΜΙΑ ΣΕΙΡΑ ΑΠΡΟΣΜΕΝΩΝ ΠΡΟΒΛΗΜΑΤΩΝ ΓΙΑ ΚΑΘΕ ΤΑΞΙΔΙΩΤΗ ΠΟΥ ΤΟ ΕΠΙΣΚΕΠΤΟΤΑΝ.',
        answer: 'ΑΠΟΞΗΡΑΜΕΝΑ ΨΑΡΙΑ',
        lies: ['ΓΥΑΛΙΣΜΕΝΑ ΚΟΧΥΛΙΑ', 'ΠΑΛΙΑ ΚΑΡΦΙΑ ΠΛΟΙΩΝ', 'ΜΠΟΥΚΑΛΙΑ ΒΡΟΧΙΝΟΥ ΝΕΡΟΥ', 'ΧΕΙΡΟΠΟΙΗΤΑ ΞΥΛΙΝΑ ΜΑΡΚΑ', 'ΣΑΚΙΑ ΑΛΑΤΙΟΥ', 'ΦΤΕΡΑ ΑΠΟ ΣΠΑΝΙΑ ΠΟΥΛΙΑ'],
        names: ['ΑΛΕΞΑΝΔΡΑ-Χ', 'ΜΑΞΙΜΙΛΙΑΝΟΣ', 'ΚΑΤΕΡΙΝΑ-ΜΑΡ', 'ΣΕΒΑΣΤΙΑΝΟΣ', 'ΙΩΑΝΝΑ-ΣΟΦΙΑ', 'ΧΡΗΣΤΟΣ-ΤΖΡ'],
    },
};

export const COPY_BY_LANGUAGE = { en: EN, el: EL };

export const TEXT_LENGTH_OPTIONS: Array<{ value: TextLength; label: string }> = [
    { value: 'short', label: 'Short' },
    { value: 'normal', label: 'Normal' },
    { value: 'long', label: 'Long' },
    { value: 'extreme', label: 'Extreme' },
];

export const SCREEN_GROUPS: ScreenGroup[] = ['App', 'Join', 'Game'];

export function getCopy(config: DesignerConfig): CopySet {
    const base = COPY_BY_LANGUAGE[config.language][config.contentLength];
    const names = base.names.map((name, index) => config.overrides.names?.[index] ?? name);
    const lies = base.lies.map((lie, index) => config.overrides.lies?.[index] ?? lie);
    return {
        category: config.overrides.category ?? base.category,
        fact: config.overrides.fact ?? base.fact,
        answer: config.overrides.answer ?? base.answer,
        lies,
        names,
    };
}

export function getCategoryOptions(config: DesignerConfig, copy: CopySet): string[] {
    const defaults = config.language === 'el'
        ? ['ΖΩΑ', 'ΠΕΡΙΕΡΓΗ ΙΣΤΟΡΙΑ', 'ΔΙΑΣΤΗΜΑ', 'ΦΑΓΗΤΟ']
        : ['ANIMALS', 'WEIRD HISTORY', 'SPACE', 'FOOD FACTS'];
    return Array.from(new Set([copy.category, ...defaults])).slice(0, 4);
}
