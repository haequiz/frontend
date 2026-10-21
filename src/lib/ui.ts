/** 화면 아래 알림 (index.html 의 #toast) */
export function toast(msg: string, isError = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('err', isError);
  el.classList.add('show');
  window.clearTimeout((toast as any)._t);
  (toast as any)._t = window.setTimeout(() => el.classList.remove('show'), 2800);
}

export const GLYPHS = ['▲', '◆', '●', '■', '★', '✚'];
export const TYPE_LABEL: Record<string, string> = { mc: '객관식', ox: 'OX', short: '주관식' };

/** 보기 색: 객관식은 순서대로, OX 는 O 파랑 · X 빨강 */
export function optionColor(type: string, index: number, label?: string) {
  if (type === 'ox') return label === 'X' ? 'sig-1' : 'sig-2';
  return `sig-${(index % 6) + 1}`;
}

export function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => {});
}
