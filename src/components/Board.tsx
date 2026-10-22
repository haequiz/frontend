import type { BoardRow } from '../lib/types';

/** 순위표 한 줄 (진행 · 관객 화면 공용) */
export function Row({ r, gain }: { r: BoardRow; gain?: string }) {
  return (
    <div className="brow">
      <div className="brow__rank">{r.tied && <em>공동</em>}{r.rank}</div>
      <div className="brow__nick">{r.displayName}</div>
      <div className="brow__gain">{gain ?? ''}</div>
      <div className="brow__score">{r.score}</div>
    </div>
  );
}
