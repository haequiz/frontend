import '../../styles/call.css';

import { useEffect, useRef, useState } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react';
import { api } from '../../lib/api';
import { getOperator, goLogin } from '../../lib/auth';
import { toast } from '../../lib/ui';
import { DISPATCHER_PROMPT } from './prompt';

/* ============================================================
   119 모의 신고 (화재 신고 훈련)
   진행자 노트북을 빔에 연결해 쓴다. 학생이 현장에서 받은 화재 장면 사진을 보고 마이크에 말하면
   ElevenLabs 상담원 에이전트가 목소리로 답한다. 실제 전화는 걸지 않는다.
   ============================================================ */

const CLOSING = '접수되었습니다';   // 지시문에서 마지막 대답에만 넣게 한 말. 이 대답이 끝나면 끊는다
const HANG_UP_MS = 2000;           // 마지막 대답 뒤 이만큼 조용하면 끊는다 (문장 사이 쉼에서 끊기지 않게)
const TALK_LEVEL = 0.12;           // 마이크 소리(0~1)가 이보다 크면 학생이 말하는 중으로 본다
const TALK_HOLD_MS = 300;          // 말 사이 짧은 쉼에 표시가 깜빡이지 않게 이만큼 유지한다

type Line = { who: 'user' | 'agent'; text: string };

export default function CallPage() {
  if (!getOperator()) {
    goLogin();
    return null;
  }
  return <ConversationProvider><Call /></ConversationProvider>;
}

function Call() {
  const [started, setStarted] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [lag, setLag] = useState<number | null>(null);
  const [ended, setEnded] = useState(false);
  const [talking, setTalking] = useState(false);   // 학생 목소리가 마이크에 들어오는 중
  const micRef = useRef<HTMLDivElement>(null);
  const agentSpeaking = useRef(false);
  const peak = useRef(0);              // 학생이 한 번 말하는 동안 가장 큰 마이크 소리 (TALK_LEVEL 맞출 때 본다)
  const turns = useRef(0);
  const closing = useRef(false);       // 마지막 대답을 받았다
  const heardAt = useRef(0);           // 학생 목소리가 마지막으로 들린 시각 (마이크 소리로 잰다)
  const replyPending = useRef(false);  // 학생 말이 끝나 상담원 대답을 기다리는 중 (응답 시간은 이때만 잰다)
  const hangUp = useRef(0);            // 마지막 대답 뒤 끊기 타이머

  const conversation = useConversation({
    onMessage: ({ role, message }) => {
      const text = message.trim();
      if (!text || /^[.…\s]+$/.test(text)) return;   // 조용할 때 오는 빈 인식 결과
      console.info(`[call] ${role === 'agent' ? '119' : '학생'}: ${text}`, role === 'user' ? `(마이크 최대 ${peak.current.toFixed(2)})` : '');
      if (role === 'user') peak.current = 0;
      setLines(prev => [...prev, { who: role, text }]);
      if (role === 'user') {
        turns.current += 1;
        replyPending.current = true;
      } else if (text.includes(CLOSING)) closing.current = true;
    },
    onModeChange: ({ mode }) => {
      const now = performance.now();
      agentSpeaking.current = mode === 'speaking';
      clearTimeout(hangUp.current);
      if (mode === 'speaking') {
        // 학생이 말을 마친 뒤 상담원 목소리가 나오기까지 (1.5초 안이 목표). 문장 사이 쉼은 재지 않는다
        if (replyPending.current) {
          replyPending.current = false;
          setLag(now - heardAt.current);
          console.info(`[call] 응답 ${((now - heardAt.current) / 1000).toFixed(2)}초`);
        }
        return;
      }
      // WebRTC 는 문장 사이 잠깐 쉴 때도 듣는 중으로 바뀌므로 조용함이 이어질 때만 끊는다
      if (closing.current) {
        hangUp.current = window.setTimeout(() => {
          console.info('[call] 마무리 대답이 끝나 통화를 끊음');
          conversation.endSession();
        }, HANG_UP_MS);
      }
    },
    onConnect: ({ conversationId }) => console.info('[call] 연결됨', conversationId),
    onDisconnect: details => {
      clearTimeout(hangUp.current);
      console.info('[call] 통화 끝 -', details.reason, `(학생 ${turns.current}번 말함)`);
      setEnded(true);
    },
    onError: (message, context) => {
      console.error('[call] 오류', message, context);
      toast(message || '통화 중 오류가 났습니다.', true);
    },
  });

  // 마이크 소리를 매 프레임 읽어 링 크기에 반영하고, 말하는 중인지 판단한다 (상담원이 말할 때는 듣지 않는다)
  const live = conversation.status === 'connected';
  const { getInputVolume } = conversation;
  useEffect(() => {
    if (!live) return;
    let frame = 0;
    let on = false;
    function tick() {
      frame = requestAnimationFrame(tick);
      const now = performance.now();
      const level = agentSpeaking.current ? 0 : getInputVolume();
      micRef.current?.style.setProperty('--level', level.toFixed(3));
      peak.current = Math.max(peak.current, level);
      if (level > TALK_LEVEL) heardAt.current = now;
      const next = now - heardAt.current < TALK_HOLD_MS;
      if (next !== on) setTalking(on = next);
    }
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      setTalking(false);
    };
  }, [live, getInputVolume]);

  async function start() {
    console.info('[call] 통화 시작');
    setStarted(true);
    setLines([]);
    setLag(null);
    setEnded(false);
    turns.current = 0;
    closing.current = false;
    heardAt.current = 0;
    replyPending.current = false;
    peak.current = 0;
    try {
      // 마이크 허락은 버튼을 누른 순간에 받아 둬야 토큰을 기다린 뒤에도 열린다
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      mic.getTracks().forEach(track => track.stop());
      const { token } = await api<{ token: string }>('/api/voice/call', { method: 'POST' });
      conversation.startSession({
        conversationToken: token,
        connectionType: 'webrtc',
        overrides: { agent: { prompt: { prompt: DISPATCHER_PROMPT } } },
      });
    } catch (e) {
      console.error('[call] 통화를 시작하지 못함', e);
      const { name, message } = e as Error;
      toast(name === 'NotAllowedError' ? '마이크 권한을 허용해 주세요.' : message, true);
      setStarted(false);
    }
  }

  if (!started) {
    return (
      <main className="call call--pick">
        <p className="eyebrow">화재 신고 훈련</p>
        <h1 className="call__title">119 모의 신고</h1>
        <button className="btn btn--primary btn--lg" onClick={start}>시작</button>
        <p className="call__note">실제 119로 전화가 걸리지 않습니다. 학생 목소리는 녹음해 두지 않습니다.</p>
      </main>
    );
  }

  const over = ended || conversation.status === 'error';
  const from = Math.max(0, lines.length - 3);   // 자막은 최근 세 줄만 (글씨가 커서)
  return (
    <main className="call">
      <header className="call__top">
        <span className="call__drill">모의 훈련</span>
        {lag !== null && <span className="call__lag num">응답 {(lag / 1000).toFixed(1)}초</span>}
      </header>

      <div ref={micRef} className={`call__mic ${talking ? 'is-talking' : ''} ${!live || over || conversation.isSpeaking ? 'is-off' : ''}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" />
        </svg>
      </div>

      <p className={`call__status ${live && conversation.isSpeaking ? 'is-agent' : ''}`}>
        {over ? '신고가 끝났습니다'
          : !live ? '119에 연결하는 중…'
          : conversation.isSpeaking ? '119 상담원이 말하는 중'
          : talking ? '듣고 있어요…' : '말씀하세요'}
      </p>

      <div className="call__lines">
        {lines.slice(from).map((l, i) => (
          <p key={from + i} className={`call__line call__line--${l.who}`}>
            <span>{l.who === 'agent' ? '119' : '나'}</span>{l.text}
          </p>
        ))}
      </div>

      <div className="call__actions">
        {over ? (
          <button className="btn btn--primary btn--lg" onClick={start}>다시 하기</button>
        ) : (
          <button className="btn btn--lg btn--danger" onClick={() => conversation.endSession()}>통화 끝내기</button>
        )}
      </div>
    </main>
  );
}
