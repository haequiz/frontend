/* ============================================================
   테마 — 모든 화면이 공유한다 (기존 quizlive theme.js 이식).
   운영자가 고르는 색은 5가지(배경·패널·글자·강조·보기색)뿐이고
   테두리·흐린 글자 같은 나머지는 여기서 자동으로 만들어낸다.
   ============================================================ */
import type { Theme } from './types';

export const DEFAULT_THEME: Theme = {
  preset: 'midnight',
  ink: '#080C1A',
  stage: '#101733',
  chalk: '#EDF1FF',
  accent: '#3D9BFF',
  sig: ['#FF4D6D', '#3D9BFF', '#FFC13D', '#2BD9A6', '#B07CFF', '#FF8A3D'],
  bgDim: 0.22,
};

export const PRESETS: Record<string, Omit<Theme, 'preset'> & { label: string }> = {
  midnight: { label: '미드나이트', ink: '#080C1A', stage: '#101733', chalk: '#EDF1FF', accent: '#3D9BFF', sig: ['#FF4D6D', '#3D9BFF', '#FFC13D', '#2BD9A6', '#B07CFF', '#FF8A3D'], bgDim: 0.22 },
  charcoal: { label: '차콜', ink: '#0D0D0F', stage: '#1A1A1E', chalk: '#F2F2F5', accent: '#8B8BF5', sig: ['#F2555A', '#4D9DE0', '#F5B841', '#3DBE8B', '#A97FF0', '#F08A3C'], bgDim: 0.25 },
  forest: { label: '포레스트', ink: '#06120E', stage: '#0F2019', chalk: '#EAF5EE', accent: '#3FBF7F', sig: ['#E8615C', '#3D9BC9', '#EFC04F', '#3FBF7F', '#9B7FD4', '#EB8A4A'], bgDim: 0.22 },
  wine: { label: '와인', ink: '#140810', stage: '#25121D', chalk: '#F8ECF2', accent: '#E0578A', sig: ['#E0578A', '#5B9DD9', '#F2B84B', '#43C79B', '#B27CE8', '#F0813F'], bgDim: 0.24 },
  daylight: { label: '데이라이트', ink: '#F4F6FC', stage: '#FFFFFF', chalk: '#141A2E', accent: '#2B6EF5', sig: ['#E63E5F', '#2B6EF5', '#E5A21B', '#12A87A', '#8A4FE0', '#E06A18'], bgDim: 0.18 },
  school: { label: '스쿨', ink: '#0A1420', stage: '#12233A', chalk: '#EAF3FF', accent: '#FFB43D', sig: ['#FF6B6B', '#4DA3FF', '#FFB43D', '#3FD08A', '#A97BF0', '#FF8E52'], bgDim: 0.22 },
};

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

function toRgb(hex: string) {
  let h = String(hex || '').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

const toHex = ({ r, g, b }: { r: number; g: number; b: number }) =>
  ('#' + [r, g, b].map(v => clamp255(v).toString(16).padStart(2, '0')).join('')).toUpperCase();

/** a 에서 b 쪽으로 t 만큼 섞는다 (0~1) */
export function mix(a: string, b: string, t: number) {
  const x = toRgb(a), y = toRgb(b);
  return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

const rgba = (hex: string, a: number) => {
  const { r, g, b } = toRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

/** 사람 눈이 느끼는 밝기 (0~1) */
function luminance(hex: string) {
  const { r, g, b } = toRgb(hex);
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** 그 색 위에 얹을 글자색 — 밝으면 검정, 어두우면 흰색 */
const readableInk = (hex: string) => (luminance(hex) > 0.42 ? '#0B1020' : '#FFFFFF');

export function normalize(theme?: Partial<Theme> | null): Theme {
  const base = { ...DEFAULT_THEME, ...(theme || {}) };
  const hex = (v: unknown, fallback: string) =>
    /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(String(v || '')) ? toHex(toRgb(String(v))) : fallback;
  return {
    preset: String(base.preset || 'custom'),
    ink: hex(base.ink, DEFAULT_THEME.ink),
    stage: hex(base.stage, DEFAULT_THEME.stage),
    chalk: hex(base.chalk, DEFAULT_THEME.chalk),
    accent: hex(base.accent, DEFAULT_THEME.accent),
    sig: DEFAULT_THEME.sig.map((d, i) => hex(base.sig?.[i], d)),
    bgDim: Math.max(0, Math.min(1, Number(base.bgDim ?? DEFAULT_THEME.bgDim))),
  };
}

/** 테마를 실제 CSS 변수로 적용한다. root 를 주면 미리보기 영역에만 적용된다 */
export function applyTheme(theme?: Partial<Theme> | null, root?: HTMLElement | null): Theme {
  const t = normalize(theme);
  const s = (root || document.documentElement).style;
  const { r, g, b } = toRgb(t.ink);
  s.setProperty('--ink', t.ink);
  s.setProperty('--ink-rgb', `${r}, ${g}, ${b}`);
  s.setProperty('--stage', t.stage);
  s.setProperty('--stage-2', mix(t.stage, t.chalk, 0.07));
  s.setProperty('--stage-3', mix(t.stage, t.chalk, 0.14));
  s.setProperty('--line', mix(t.stage, t.chalk, 0.2));
  s.setProperty('--chalk', t.chalk);
  s.setProperty('--muted', mix(t.chalk, t.stage, 0.42));
  s.setProperty('--dim', mix(t.chalk, t.stage, 0.62));
  s.setProperty('--accent', t.accent);
  s.setProperty('--accent-2', mix(t.accent, t.ink, 0.28));
  s.setProperty('--accent-ink', readableInk(t.accent));
  s.setProperty('--glow-a', rgba(t.accent, 0.16));
  s.setProperty('--glow-b', rgba(t.sig[4], 0.1));
  s.setProperty('--bg-dim', String(t.bgDim));
  t.sig.forEach((c, i) => {
    s.setProperty(`--sig-${i + 1}`, c);
    s.setProperty(`--sig-${i + 1}-ink`, readableInk(c));
  });
  return t;
}
