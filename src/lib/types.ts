/* 백엔드(QuizDtos · GameService)와 같은 모양 */

export type QuestionType = 'mc' | 'ox' | 'short';

export interface Theme {
  preset: string;
  ink: string;
  stage: string;
  chalk: string;
  accent: string;
  sig: string[];
  bgDim: number;
}

export interface Option {
  id?: number | null;
  text: string;
  image: string;
  correct: boolean;
}

export interface Question {
  id?: number | null;
  type: QuestionType;
  text: string;
  image: string;
  points: number;
  explanation: string;
  options: Option[];
  answers: string[];
  caseSensitive: boolean;
  ignoreSpaces: boolean;
  ignorePunctuation: boolean;
}

export interface Video {
  id?: number | null;
  title: string;
  url: string;
}

export interface Quiz {
  id: number;
  title: string;
  description: string;
  titleImage: string;
  backgroundImage: string;
  theme: Theme;
  questions: Question[];
  videos: Video[];
  createdAt?: string;
  updatedAt?: string;
}

export interface QuizSummary {
  id: number;
  title: string;
  description: string;
  titleImage: string;
  questionCount: number;
  videoCount: number;
  updatedAt: string;
}

/** 진행 중 화면에 보내는 퀴즈 정보 */
export interface QuizMeta {
  title: string;
  titleImage: string;
  backgroundImage: string;
  theme: Theme;
  total: number;
  videos?: Video[] | null;
}

export interface QuestionView {
  index: number;
  total: number;
  id: number;
  type: QuestionType;
  text: string;
  image: string;
  points: number;
  options: { id: string; text: string; image: string; correct?: boolean }[];
  answers?: string[];
  explanation?: string;
}

export interface Progress {
  answered: number;
  changed: number;
  total: number;
}

export interface Bucket {
  key: string;
  label: string;
  index?: number;
  count: number;
  correct: boolean;
}

export interface Tally {
  index: number;
  type: QuestionType;
  question: string;
  image: string;
  explanation: string;
  correctLabels: string[];
  buckets: Bucket[];
  answered: number;
  noAnswer: number;
  correctCount: number;
  wrongCount: number;
  total: number;
  max: number;
}

export interface BoardRow {
  rank: number;
  tied: boolean;
  id?: string;
  displayName: string;
  score: number;
  gained?: number;
  correct?: boolean;
  correctCount?: number;
}

export interface Reveal {
  tally: Tally;
  scoreboard: BoardRow[];
}

export interface Ended {
  podium: BoardRow[];
  scoreboard: BoardRow[];
  shownTop: number;
  totalPlayers: number;
  totalQuestions: number;
}

export interface PlayerRow {
  id: string;
  displayName: string;
  score: number;
  online: boolean;
}

export interface PlayerList {
  count: number;
  list: PlayerRow[];
}

/* ---------- 참여자 개인 ---------- */

export interface PersonalResult {
  index: number;
  answered: boolean;
  correct: boolean;
  gained: number;
  myAnswer: string | null;
  score: number;
  rank: number;
  tied: boolean;
  total: number;
  correctLabels: string[];
  explanation: string;
  regraded: boolean;
}

export interface PersonalRank {
  rank: number;
  tied: boolean;
  score: number;
  total: number;
}

export interface PersonalFinal extends PersonalRank {
  correctCount: number;
  totalQuestions: number;
}

export type RoomState = 'lobby' | 'question' | 'reveal' | 'scoreboard' | 'ended';

export interface PlayerSnapshot {
  state: RoomState;
  score: number;
  videoPlaying: boolean;
  question: QuestionView | null;
  myAnswer: { value: string; label: string } | null;
  result: PersonalResult | null;
  rank: PersonalRank | null;
  final: PersonalFinal | null;
}

export interface JoinReply {
  participantId: string;
  token: string;
  displayName: string;
  grade: number;
  classNo: number;
  name: string;
  pin: string;
  resumed: boolean;
  quiz: QuizMeta;
  snapshot: PlayerSnapshot;
}
