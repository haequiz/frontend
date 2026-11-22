import type { CSSProperties } from 'react';
import type { Ended } from '../lib/types';

/** 결선 진출자 명단 (진행 · 관객 화면 공용). 순위 없이 이름만, 10줄씩 최대 3열로 위에서 아래로 */
export function Finalists({ ended }: { ended: Ended }) {
  const n = ended.finalists.length;
  const cols = Math.max(1, Math.ceil(n / 10));
  const rows = cols === 1 ? 10 : Math.ceil(n / cols);
  const style = { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, '--rows': rows } as CSSProperties;
  return (
    <div className="finalists" style={style}>
      {ended.finalists.map(name => <div key={name} className="finalist">{name}</div>)}
    </div>
  );
}
