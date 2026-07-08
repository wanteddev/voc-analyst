// Client-safe types & constants for surge level filtering. queries.ts는 bigquery client를
// import하므로 클라이언트 컴포넌트에서 import 불가. 여기 상수는 순수 데이터라서 안전.

export type SurgeLevel = 'SURGE' | 'WATCH' | 'STABLE' | 'IMPROVED';
export type LevelKey = 'all' | 'surge' | 'watch' | 'stable' | 'improved';

export const SURGE_ORDER: SurgeLevel[] = ['SURGE', 'WATCH', 'STABLE', 'IMPROVED'];

export const LEVEL_KEY_TO_SURGE: Record<Exclude<LevelKey, 'all'>, SurgeLevel> = {
  surge: 'SURGE',
  watch: 'WATCH',
  stable: 'STABLE',
  improved: 'IMPROVED',
};

export const SURGE_TO_LEVEL_KEY: Record<SurgeLevel, Exclude<LevelKey, 'all'>> = {
  SURGE: 'surge',
  WATCH: 'watch',
  STABLE: 'stable',
  IMPROVED: 'improved',
};

// 감정 필터 — URL param 'emo' ↔ BQ emotion 컬럼 값
export type EmotionKey = 'all' | 'negative' | 'positive' | 'neutral';
export const EMOTION_TO_KO: Record<Exclude<EmotionKey, 'all'>, string> = {
  negative: '부정',
  positive: '긍정',
  neutral: '중립',
};
export const EMOTION_LABEL: Record<EmotionKey, string> = {
  all: '전체',
  negative: '부정',
  positive: '긍정',
  neutral: '중립',
};
