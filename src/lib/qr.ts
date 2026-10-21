import QRCode from 'qrcode';

/** 입장 QR (진행 · 관객 화면만 쓴다 — 참여자 태블릿이 받지 않도록 따로 둔다) */
export function qrDataUrl(text: string, size = 420): Promise<string> {
  return QRCode.toDataURL(text, { margin: 1, width: size, color: { dark: '#0B1020', light: '#FFFFFF' } });
}
