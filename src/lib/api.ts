import { API_URL } from './config';
import { getOperator, goLogin } from './auth';

/** 운영자 REST 호출. 오류는 백엔드의 { error } 메시지를 그대로 던진다 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const op = getOperator();
  const headers = new Headers(init.headers);
  if (op) headers.set('Authorization', `Bearer ${op.token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const res = await fetch(API_URL + path, { ...init, headers });
  if (res.status === 401) {
    goLogin();
    throw new Error('다시 로그인해 주세요.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '요청에 실패했습니다.');
  return data as T;
}

/** 파일 업로드 (영상은 커서 진행률을 보여 주려고 XHR) */
export function upload(kind: 'image' | 'video', file: File, onProgress?: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/api/media/${kind}`);
    const op = getOperator();
    if (op) xhr.setRequestHeader('Authorization', `Bearer ${op.token}`);
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onloadend = () => {
      let data: { url?: string; error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* 응답 없음 */
      }
      if (xhr.status === 401) goLogin();
      if (xhr.status === 200 && data.url) resolve(data.url);
      else reject(new Error(data.error || '파일을 올리지 못했습니다.'));
    };
    xhr.send(fd);
  });
}

/** 결과 CSV 내려받기 (링크로는 인증 헤더를 못 붙이므로 받아서 저장) */
export async function downloadResults(pin: string) {
  const op = getOperator();
  const res = await fetch(`${API_URL}/api/rooms/${pin}/results.csv`, {
    headers: op ? { Authorization: `Bearer ${op.token}` } : {},
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '결과를 받지 못했습니다.');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = `haequiz-${pin}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
