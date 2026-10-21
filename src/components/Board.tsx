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

/** 시상대 — 2등 · 1등 · 3등 순서로 세운다 */
export function Podium({ podium }: { podium: BoardRow[] }) {
  const medals = ['🥇', '🥈', '🥉'];
  return (
    <div className="podium">
      {[1, 0, 2].filter(i => podium[i]).map(i => {
        const p = podium[i];
        return (
          <div key={i} className={`pod pod--${p.rank}`}>
            <div className="pod__medal">{medals[p.rank - 1] || '🎖️'}</div>
            <div className="pod__nick">{p.tied && <em className="pod__tie">공동</em>}{p.displayName}</div>
            <div className="pod__score">{p.score}점</div>
            <div className="pod__block">{p.rank}</div>
          </div>
        );
      })}
    </div>
  );
}
