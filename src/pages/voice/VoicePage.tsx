import '../../styles/voice.css';

import { useRef, useState } from 'react';
import { api, voiceSpeech } from '../../lib/api';
import { getOperator, goLogin } from '../../lib/auth';
import { toast } from '../../lib/ui';

/* ============================================================
   음성 실습 (보이스피싱 예방 교육)
   동의한 사람의 목소리를 복제해 서버에 정해 둔 대본 중 고른 것을 읽는다.
   API 키와 대본은 백엔드에 있고, 복제한 목소리는 끝내면 지운다.
   ============================================================ */

type Step = 'ready' | 'countdown' | 'recording' | 'cloning' | 'script' | 'speaking';
type Script = { label: string; text: string };

const RECORD_SECONDS = 12;
const READ_ALOUD = '안녕하세요. 저는 지금 제 목소리를 녹음하고 있습니다. 오늘은 보이스피싱을 알아차리는 방법을 함께 배워 보겠습니다. 목소리가 비슷해도 꼭 다시 확인해야 합니다.';

const wait = (ms: number) => new Promise(done => setTimeout(done, ms));

function encodeWav(samples: Float32Array, rate: number) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, 1, true);          // 모노
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((v, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 32767, true));
  return new Blob([view], { type: 'audio/wav' });
}

/** 받는 대로 재생해서 전부 만들어질 때까지 기다리지 않는다 */
async function playStream(audio: HTMLAudioElement, body: ReadableStream<Uint8Array<ArrayBuffer>>) {
  const source = new MediaSource();
  audio.src = URL.createObjectURL(source);
  await new Promise(done => source.addEventListener('sourceopen', done, { once: true }));
  const buffer = source.addSourceBuffer('audio/mpeg');
  const reader = body.getReader();
  audio.play().catch(() => {});
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    buffer.appendBuffer(part.value);
    await new Promise(done => buffer.addEventListener('updateend', done, { once: true }));
  }
  source.endOfStream();
}

function errorText(e: unknown) {
  const { name, message } = e as Error;
  if (name === 'NotAllowedError') return '마이크 권한을 허용해 주세요.';
  if (name === 'NotFoundError') return '마이크를 찾을 수 없습니다.';
  return name === 'Error' ? message : '처리하지 못했습니다. 인터넷과 마이크를 확인해 주세요.';
}

export default function VoicePage() {
  const [step, setStep] = useState<Step>('ready');
  const [count, setCount] = useState(0);
  const [consent, setConsent] = useState(false);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [chosen, setChosen] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const speechRef = useRef<AbortController | null>(null);

  if (!getOperator()) {
    goLogin();
    return null;
  }

  function backToReady() {
    setConsent(false);
    setStep('ready');
  }

  async function recordSample(mic: MediaStream) {
    const recorder = new MediaRecorder(mic);
    const chunks: Blob[] = [];
    recorder.ondataavailable = e => chunks.push(e.data);
    const stopped = new Promise(done => { recorder.onstop = done; });
    recorder.start();
    setStep('recording');
    for (let s = RECORD_SECONDS; s > 0; s--) {
      setCount(s);
      await wait(1000);
    }
    recorder.stop();
    await stopped;
    const audio = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await new Blob(chunks).arrayBuffer());
    const samples = audio.getChannelData(0);
    if (!samples.some(v => Math.abs(v) > 0.02)) throw new Error('목소리가 들리지 않았습니다. 마이크를 확인해 주세요.');
    return encodeWav(samples, audio.sampleRate);
  }

  async function record() {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        // 통화용 보정은 음색을 바꿔 복제 품질을 떨어뜨린다
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      let sample: Blob;
      try {
        setStep('countdown');
        for (let s = 3; s > 0; s--) {
          setCount(s);
          await wait(1000);
        }
        sample = await recordSample(mic);
      } finally {
        mic.getTracks().forEach(track => track.stop());   // 녹음이 끝나면 바로 끈다
      }
      setStep('cloning');
      const form = new FormData();
      form.append('file', sample, 'sample.wav');
      const res = await api<{ scripts: Script[] }>('/api/voice', { method: 'POST', body: form });
      setScripts(res.scripts);
      setChosen(0);
      setStep('script');
    } catch (e) {
      toast(errorText(e), true);
      backToReady();
    }
  }

  function stopSpeech() {
    speechRef.current?.abort();
    speechRef.current = null;
    const audio = audioRef.current!;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }

  async function speak() {
    setStep('speaking');
    const controller = new AbortController();
    speechRef.current = controller;
    try {
      await playStream(audioRef.current!, await voiceSpeech(chosen, controller.signal));
    } catch (e) {
      if (controller.signal.aborted) return;   // 진행자가 멈춘 경우
      stopSpeech();
      toast(errorText(e), true);
      setStep('script');
    }
  }

  async function finish() {
    if (!window.confirm('실습을 끝내고 복제한 목소리를 삭제할까요?')) return;
    stopSpeech();
    try {
      await api('/api/voice', { method: 'DELETE' });
      toast('복제한 목소리를 삭제했습니다.');
    } catch {
      toast('지금 삭제하지 못했습니다. 30분 안에 자동으로 삭제됩니다.', true);
    }
    setScripts([]);
    backToReady();
  }

  return (
    <main className="voice">
      <audio ref={audioRef} onEnded={() => setStep('script')} />

      {step === 'ready' && (
        <>
          <p className="eyebrow">보이스피싱 예방 교육</p>
          <h1 className="voice__title">AI 목소리 복제 체험</h1>
          <label className="voice__consent">
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
            목소리 복제에 동의를 받았습니다.
          </label>
          <button className="btn btn--primary btn--lg" disabled={!consent} onClick={record}>녹음 시작</button>
          <p className="voice__note">복제한 목소리는 실습을 끝내면 삭제되고, 끝내지 않아도 30분 뒤 자동으로 삭제됩니다.</p>
        </>
      )}

      {step === 'countdown' && (
        <>
          <p className="eyebrow">곧 녹음을 시작합니다. 아래 문장을 읽어 주세요</p>
          <p className="voice__read">{READ_ALOUD}</p>
          <div className="voice__count">{count}</div>
        </>
      )}

      {step === 'recording' && (
        <>
          <p className="eyebrow">● 녹음 중 · {count}초 남음</p>
          <p className="voice__read">{READ_ALOUD}</p>
        </>
      )}

      {step === 'cloning' && <h1 className="voice__title">목소리를 복제하는 중입니다</h1>}

      {(step === 'script' || step === 'speaking') && (
        <>
          <span className="voice__fake">AI로 만든 가짜 음성</span>
          <div className="voice__actions">
            {scripts.map((s, i) => (
              <button key={s.label} className={`btn ${i === chosen ? 'btn--primary' : ''}`} disabled={step === 'speaking'} onClick={() => setChosen(i)}>{s.label}</button>
            ))}
          </div>
          <p className="voice__read">{scripts[chosen].text}</p>
          <div className="voice__actions">
            {step === 'speaking' ? (
              <button className="btn btn--lg" onClick={() => { stopSpeech(); setStep('script'); }}>멈추기</button>
            ) : (
              <>
                <button className="btn btn--primary btn--lg" onClick={speak}>대본 읽기</button>
                <button className="btn btn--lg" onClick={backToReady}>다시 녹음</button>
                <button className="btn btn--lg btn--danger" onClick={finish}>실습 끝내기</button>
              </>
            )}
          </div>
        </>
      )}
    </main>
  );
}
