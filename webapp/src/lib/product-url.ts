// /product URL 파라미터 통합 관리 — 필터 컴포넌트들이 href 만들 때 사용.
import { SURGE_ORDER, SURGE_TO_LEVEL_KEY, type SurgeLevel, type EmotionKey } from './level';

export type ProductFilters = {
  seg: 'all' | 'user' | 'company';
  levels: SurgeLevel[];
  emotion: EmotionKey;
  category2: string | null;
  category3: string | null;
  asOf: string | null; // null이면 default(어제) 사용
};

export function buildProductHref(patch: Partial<ProductFilters>, base: ProductFilters): string {
  const next: ProductFilters = { ...base, ...patch };
  const p = new URLSearchParams();
  if (next.seg !== 'all') p.set('seg', next.seg);
  if (next.levels.length > 0) {
    const encoded = SURGE_ORDER.filter(l => next.levels.includes(l)).map(l => SURGE_TO_LEVEL_KEY[l]).join(',');
    p.set('level', encoded);
  }
  if (next.emotion !== 'all') p.set('emo', next.emotion);
  if (next.category2) p.set('cat2', next.category2);
  if (next.category3) p.set('cat3', next.category3);
  if (next.asOf) p.set('asOf', next.asOf);
  const qs = p.toString();
  return qs ? `/product?${qs}` : '/product';
}
