import '../../styles/call.css';

import { useRef, useState } from 'react';
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
  const turns = useRef(0);
  const closing = useRef(false);       // 마지막 대답을 받았다
  const heardAt = useRef(0);           // 학생 목소리가 마지막으로 들린 시각
  const agentDoneAt = useRef(0);       // 상담원이 마지막으로 말을 마친 시각
  const hangUp = useRef(0);            // 마지막 대답 뒤 끊기 타이머

  const conversation = useConversation({
    onMessage: ({ role, message }) => {
      const text = message.trim();
      if (!text || /^[.…\s]+$/.test(text)) return;   // 조용할 때 오는 빈 인식 결과
      console.info(`[call] ${role === 'agent' ? '119' : '학생'}: ${text}`);
      setLines(prev => [...prev, { who: role, text }]);
      if (role === 'user') turns.current += 1;
      else if (text.includes(CLOSING)) closing.current = true;
    },
    onVadScore: ({ vadScore }) => {
      if (vadScore > 0.5) heardAt.current = performance.now();
    },
    onModeChange: ({ mode }) => {
      const now = performance.now();
      clearTimeout(hangUp.current);
      if (mode === 'speaking') {
        // 학생이 말을 마친 뒤 상담원 목소리가 나오기까지 (1.5초 안이 목표)
        if (heardAt.current > agentDoneAt.current) {
          setLag(now - heardAt.current);
          console.info(`[call] 응답 ${((now - heardAt.current) / 1000).toFixed(2)}초`);
        }
        return;
      }
      agentDoneAt.current = now;
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

  async function start() {
    console.info('[call] 통화 시작');
    setStarted(true);
    setLines([]);
    setLag(null);
    setEnded(false);
    turns.current = 0;
    closing.current = false;
    heardAt.current = 0;
    agentDoneAt.current = 0;
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

  const live = conversation.status === 'connected';
  const over = ended || conversation.status === 'error';
  const from = Math.max(0, lines.length - 4);   // 자막은 최근 네 줄만
  return (
    <main className="call">
      <header className="call__top">
        <span className="call__drill">모의 훈련</span>
        {lag !== null && <span className="call__lag num">응답 {(lag / 1000).toFixed(1)}초</span>}
      </header>

      <p className={`call__status ${live && conversation.isSpeaking ? 'is-agent' : ''}`}>
        {over ? '신고가 끝났습니다'
          : !live ? '119에 연결하는 중…'
          : conversation.isSpeaking ? '119 상담원이 말하는 중' : '말씀하세요'}
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
