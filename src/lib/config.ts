/** 백엔드 주소 (REST · WebSocket · 미디어). .env.local / Vercel 환경 변수 VITE_API_URL */
export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:8080').replace(/\/+$/, '');

/** 백엔드가 주는 /media/... 주소를 실제로 불러올 주소로 바꾼다 */
export function mediaUrl(path: string | null | undefined): string {
  if (!path) return '';
  return path.startsWith('/media/') ? API_URL + path : path;
}

/** 참여자 입장 주소 (QR) — 프론트가 올라간 주소 그대로 */
export function joinUrl(pin: string): string {
  return `${window.location.origin}/?pin=${pin}`;
}
