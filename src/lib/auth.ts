/* 운영자(행사 진행자) 로그인 — 참여자는 로그인 없이 세션 유지용 토큰만 쓴다 */

const KEY = 'haequiz.operator';

export interface Operator {
  token: string;
  username: string;
  expiresAt: string;
}

/** 출제 · 진행 · 관객 화면 탭이 함께 쓰도록 localStorage 에 둔다. 만료됐으면 없는 것으로 본다 */
export function getOperator(): Operator | null {
  try {
    const op = JSON.parse(localStorage.getItem(KEY) || 'null') as Operator | null;
    if (op && new Date(op.expiresAt).getTime() > Date.now() + 60_000) return op;
  } catch {
    /* 저장소를 못 읽으면 로그인부터 */
  }
  return null;
}

export function setOperator(op: Operator) {
  localStorage.setItem(KEY, JSON.stringify(op));
}

export function logout() {
  localStorage.removeItem(KEY);
}

/** 로그인 화면으로 보내고 끝나면 지금 주소로 돌아온다 */
export function goLogin() {
  const next = window.location.pathname + window.location.search;
  window.location.replace(`/login?next=${encodeURIComponent(next)}`);
}
