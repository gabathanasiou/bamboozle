

export type PlayerRole = 'HOST' | 'PLAYER' | 'AUDIENCE';

export enum GamePhase {
  LOBBY = 'LOBBY',
  CATEGORY_SELECT = 'CATEGORY_SELECT',
  INTRO = 'INTRO',
  WRITING = 'WRITING',
  VOTING = 'VOTING',
  REVEAL = 'REVEAL',
  LEADERBOARD = 'LEADERBOARD',
  GAME_OVER = 'GAME_OVER'
}

export type Expression = 'NEUTRAL' | 'HAPPY' | 'SAD' | 'SHOCKED' | 'SMUG' | 'THINKING' | 'ANGRY';

export interface Player {
  id: string;
  name: string;
  avatarSeed: string;
  score: number;
  isConnected: boolean;
  isReady: boolean; // New: Track ready state
  isBot?: boolean;
  currentLie?: string;
  currentVote?: string; // ID of the answer they voted for
  lastRoundScore: number;
  expression: Expression;
  previousRank?: number;
}

export interface AudienceMember {
  id: string;
  name: string;
  avatarSeed: string;
  isBot?: boolean;
  currentVote?: string;
}

export interface Emote {
  id: string;
  type: 'LAUGH' | 'SHOCK' | 'LOVE' | 'TOMATO';
  senderName: string; // For display
  senderSeed: string; // For avatar display
  x: number; // Horizontal origin, % of viewport width
  y: number; // Vertical origin, % from bottom of viewport
  createdAt: number; // For cleanup
}

export interface Question {
  id: string;
  fact: string;
  answer: string;
  category: string;
  lies: string[];
}

export interface Answer {
  id: string;
  text: string;
  authorIds: string[];
  votes: string[];
  audienceVotes: string[]; // Track audience consensus
}

export interface CategorySelectionState {
  selectorId: string;
  options: string[];
  selected: string | null;
}

export interface GameState {
  roomCode: string;
  phase: GamePhase;
  players: Record<string, Player>;
  audience: Record<string, AudienceMember>; // New Audience Roster
  currentRound: number;
  totalRounds: number;
  currentQuestion: Question | null;
  submittedLies: Record<string, string>;
  roundAnswers: Answer[];
  timeLeft: number;
  hostId: string;
  vipId: string; // New: Track the 'VIP' player who can restart game
  usedQuestionIds: string[];
  playersWhoPicked: string[];
  categorySelection: CategorySelectionState | null;
  isNarrating: boolean;
  emotes: Emote[]; // Queue of emotes to render
  isOnlineMode: boolean; // New: Track online friend mode
  recentCategories: string[]; // Categories ordered oldest offer -> newest (fair rotation)
  revealOrder: string[]; // Array of Answer IDs in the order they should be revealed
  revealStep: number; // Current index in the revealOrder
  revealSubPhase: 'INTRO' | 'CARD' | 'VOTERS' | 'AUTHOR'; // Current sub-phase of the reveal animation
  leaderboardPhase: 'INTRO' | 'REVEAL' | 'LEADER'; // Syncing the exact moment of score update
  language: 'en' | 'el'; // Current game language
  usePremiumVoices: boolean; // New: Toggle for Google Cloud TTS
  isPaused: boolean; // New: Dev-only pause state
}

export type GameEvent =
  | { type: 'SYNC_STATE'; payload: GameState }
  | { type: 'REQUEST_STATE'; payload: null }
  | { type: 'JOIN_ROOM'; payload: { id: string; name: string; avatarSeed: string; isBot?: boolean } }
  | { type: 'JOIN_AUDIENCE'; payload: { id: string; name: string; avatarSeed: string; isBot?: boolean } }
  | { type: 'TOGGLE_READY'; payload: { playerId: string } }
  | { type: 'UPDATE_ROUNDS'; payload: { rounds: number } }
  | { type: 'SUBMIT_LIE'; payload: { playerId: string; text: string } }
  | { type: 'SUBMIT_VOTE'; payload: { playerId: string; answerId: string } }
  | { type: 'SUBMIT_AUDIENCE_VOTE'; payload: { playerId: string; answerId: string } }
  | { type: 'SEND_EMOTE'; payload: { type: 'LAUGH' | 'SHOCK' | 'LOVE' | 'TOMATO'; senderName: string; senderSeed: string; x?: number; y?: number } }
  | { type: 'START_GAME'; payload: { rounds: number } }
  | { type: 'SELECT_CATEGORY'; payload: { category: string } }
  | { type: 'TOGGLE_ONLINE_MODE'; payload: null }
  | { type: 'TOGGLE_LANGUAGE'; payload: null } // New event
  | { type: 'TOGGLE_PREMIUM_VOICES'; payload: null } // New event
  | { type: 'PLAY_NARRATION'; payload: { text: string; key?: string; requestId?: string } }
  | { type: 'REMOVE_PLAYER'; payload: { playerId: string } }
  | { type: 'TOGGLE_PAUSE'; payload: null }
  | { type: 'RESTART_GAME'; payload: null };