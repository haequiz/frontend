import '../../styles/play.css';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Realtime } from '../../lib/realtime';
import { applyTheme } from '../../lib/theme';
import { mediaUrl } from '../../lib/config';
import { GLYPHS, optionColor, toast } from '../../lib/ui';
import type {
  JoinReply, PersonalFinal, PersonalRank, PersonalResult, PlayerSnapshot, QuestionView, QuizMeta,
} from '../../lib/types';

/* ============================================================
   참여자 (학교 지급 갤럭시탭)
   학년 · 반 · 이름으로 들어오고, 이 기기에는 세션 유지용 토큰만 남긴다.
   탭을 닫았다 열거나 와이파이가 끊겨도 같은 자리로 이어진다.
   ============================================================ */

type View = 'join' | 'lobby' | 'question' | 'result' | 'board' | 'end' | 'bye';

interface Saved {
  pin: string;
  grade: number;
  classNo: number;
  name: string;
  token: string;
}

const STORE = 'haequiz.player';

function loadSaved(): Saved | null {
  try {
    return JSON.parse(localStorage.getItem(STORE) || 'null');
  } catch {
    return null;
  }
}

export default function PlayerPage() {
  const rt = useMemo(() => new Realtime(), []);
  const urlPin = new URLSearchParams(window.location.search).get('pin') ?? '';

  const [view, setView] = useState<View>('join');
  const [me, setMe] = useState<JoinReply | null>(null);
  const [quiz, setQuiz] = useState<QuizMeta | null>(null);
  const [question, setQuestion] = useState<QuestionView | null>(null);
  const [mine, setMine] = useState<{ value: string; label: string; changed: boolean } | null>(null);
  const [result, setResult] = useState<PersonalResult | null>(null);
  const [rank, setRank] = useState<PersonalRank | null>(null);
  const [final, setFinal] = useState<PersonalFinal | null>(null);
  const [score, setScore] = useState(0);
  const [watching, setWatching] = useState(false);
  const [bye, setBye] = useState('');
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);

  const saved = loadSaved();
  const [pin, setPin] = useState(/^\d{6}$/.test(urlPin) ? urlPin : saved?.pin ?? '');
  const [grade, setGrade] = useState(saved ? String(saved.grade) : '');
  const [classNo, setClassNo] = useState(saved ? String(saved.classNo) : '');
  const [name, setName] = useState(saved?.name ?? '');
  const [shortValue, setShortValue] = useState('');

  const meRef = useRef<JoinReply | null>(null);
  meRef.current = me;

  /* ---------- 입장 · 재입장 ---------- */
  async function join(who: Omit<Saved, 'token'> & { token?: string }, silent = false) {
    setBusy(true);
    try {
      const r = await rt.request<JoinReply>('player.join', who);
      localStorage.setItem(STORE, JSON.stringify({
        pin: r.pin, grade: r.grade, classNo: r.classNo, name: r.name, token: r.token,
      } satisfies Saved));
      rt.subscribe(`/topic/room.${r.pin}.players`);
      setMe(r);
      setQuiz(r.quiz);
      applyTheme(r.quiz.theme);
      applySnapshot(r.snapshot);
      keepAwake();
      if (r.resumed && !silent) toast('원래 자리로 돌아왔습니다.');
    } catch (e) {
      if (silent) {
        localStorage.removeItem(STORE);   // 방이 끝났거나 사라졌다
        setView('join');
      } else {
        toast((e as Error).message, true);
      }
    } finally {
      setBusy(false);
    }
  }

  function applySnapshot(s: PlayerSnapshot) {
    setScore(s.score);
    setWatching(s.videoPlaying);
    setQuestion(s.question);
    setMine(s.myAnswer ? { ...s.myAnswer, changed: false } : null);
    setShortValue(s.myAnswer && s.question?.type === 'short' ? s.myAnswer.value : '');
    if (s.state === 'question') setView('question');
    else if (s.state === 'reveal' && s.result) { setResult(s.result); setView('result'); }
    else if (s.state === 'scoreboard' && s.rank) { setRank(s.rank); setView('board'); }
    else if (s.state === 'ended' && s.final) { setFinal(s.final); setView('end'); }
    else setView('lobby');
  }

  function leave(message: string) {
    localStorage.removeItem(STORE);
    setMe(null);
    setWatching(false);
    setBye(message);
    setView('bye');
  }

  /* ---------- 실시간 이벤트 ---------- */
  useEffect(() => {
    rt.subscribe('/user/queue/events');
    const off = [
      rt.on<QuestionView>('game.question', q => {
        setQuestion(q);
        setMine(null);
        setShortValue('');
        setView('question');
      }),
      rt.on<PersonalResult>('game.result', d => { setResult(d); setScore(d.score); setView('result'); }),
      rt.on<PersonalRank>('game.scoreboard', d => { setRank(d); setScore(d.score); setView('board'); }),
      rt.on<PersonalFinal>('game.ended', d => { setFinal(d); setScore(d.score); setView('end'); }),
      rt.on<{ playing: boolean }>('game.video', d => setWatching(d.playing)),
      rt.on<{ reason: string }>('game.closed', d => leave(d.reason || '퀴즈가 종료되었습니다')),
      rt.on('player.kicked', () => leave('진행자가 참여를 종료했습니다')),
      rt.on('player.replaced', () => leave('다른 기기에서 같은 이름으로 들어왔습니다')),
    ];
    rt.onStatus = setOnline;
    // 끊겼다 다시 붙으면 저장해 둔 토큰으로 같은 자리에 다시 앉는다
    rt.onReconnect = () => {
      const s = loadSaved();
      if (s && meRef.current) join(s, true);
    };
    rt.start();

    const s = loadSaved();
    if (s && (!/^\d{6}$/.test(urlPin) || urlPin === s.pin)) join(s, true);

    const onVisible = () => document.visibilityState === 'visible' && meRef.current && keepAwake();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      off.forEach(f => f());
      document.removeEventListener('visibilitychange', onVisible);
      rt.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onJoin(e: FormEvent) {
    e.preventDefault();
    const g = Number(grade), c = Number(classNo), n = name.trim();
    if (!/^\d{6}$/.test(pin)) return toast('PIN 6자리를 입력해 주세요.', true);
    if (!(g >= 1 && g <= 6)) return toast('학년을 1~6 사이로 입력해 주세요.', true);
    if (!(c >= 1 && c <= 20)) return toast('반을 1~20 사이로 입력해 주세요.', true);
    if (!n) return toast('이름을 입력해 주세요.', true);
    const s = loadSaved();
    const sameSeat = s && s.pin === pin && s.grade === g && s.classNo === c && s.name === n;
    join({ pin, grade: g, classNo: c, name: n, token: sameSeat ? s.token : undefined });
  }

  /* ---------- 답 제출 (마감 전까지 몇 번이든) ---------- */
  async function submit(value: string) {
    if (view !== 'question') return;
    if (navigator.vibrate) navigator.vibrate(14);
    try {
      const r = await rt.request<{ submitted: string; changed: boolean }>('player.answer', { value });
      setMine({ value, label: r.submitted, changed: r.changed });
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  const titleImage = mediaUrl(quiz?.titleImage);

  return (
    <>
      {quiz?.backgroundImage && (
        <div className="bg-layer" style={{ backgroundImage: `url("${mediaUrl(quiz.backgroundImage)}")` }} />
      )}
      <div className="app">
        {!online && me && <div className="offline">연결이 끊겼습니다. 다시 연결하는 중…</div>}
        {me && view !== 'bye' && (
          <div className="topbar">
            <span className="topbar__name">{me.displayName}</span>
            <span className="badge">PIN {me.pin}</span>
            <span className="topbar__score num">{score}</span>
          </div>
        )}

        {view === 'join' && (
          <section className="view">
            <form className="join" onSubmit={onJoin}>
              <div>
                <div className="brand">안전<em>골든벨</em></div>
              </div>
              <p className="tagline">앞 화면의 PIN 과 학년 · 반 · 이름을 입력하세요</p>
              <div className="join-form">
                <input className="pin-input" inputMode="numeric" maxLength={6} placeholder="000000"
                  autoComplete="off" aria-label="6자리 PIN" value={pin}
                  onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
                <div className="who">
                  <label>
                    <input className="num-in" inputMode="numeric" maxLength={1} placeholder="0" aria-label="학년"
                      value={grade} onChange={e => setGrade(e.target.value.replace(/\D/g, '').slice(0, 1))} />
                    학년
                  </label>
                  <label>
                    <input className="num-in" inputMode="numeric" maxLength={2} placeholder="0" aria-label="반"
                      value={classNo} onChange={e => setClassNo(e.target.value.replace(/\D/g, '').slice(0, 2))} />
                    반
                  </label>
                  <label>
                    <input className="name-in" maxLength={10} placeholder="이름" aria-label="이름" autoComplete="off"
                      value={name} onChange={e => setName(e.target.value)} />
                  </label>
                </div>
                <button className="btn btn--primary btn--lg btn--block" disabled={busy}>입장하기</button>
                <p className="join-help">화면이 꺼지거나 연결이 끊겨도 같은 학년 · 반 · 이름으로 다시 들어오면 이어서 할 수 있어요</p>
              </div>
            </form>
          </section>
        )}

        {view === 'lobby' && me && (
          <section className="view">
            <div className="center-stack">
              <div className={`title-slot ${titleImage ? 'filled' : ''}`}
                style={titleImage ? { backgroundImage: `url("${titleImage}")` } : undefined} />
              <div className="big-name">{me.displayName}</div>
              <p className="hint">입장했습니다.<br />선생님이 시작할 때까지 기다려 주세요.</p>
              <div className="dots"><i /><i /><i /></div>
            </div>
          </section>
        )}

        {view === 'question' && question && (
          <section className="view">
            <span className="q-index">{question.index + 1} / {question.total}</span>
            <div className="q-body">
              <p className="q-text">{question.text}</p>
              {question.image && <img className="q-image" src={mediaUrl(question.image)} alt="" />}
            </div>
            {mine && (
              <div className="submit-state">
                <span className="submit-state__dot" />
                <span>{mine.changed ? '답을 바꿨습니다' : '제출됨'}</span>
                <b>{mine.label}</b>
                <em>마감 전까지 바꿀 수 있어요</em>
              </div>
            )}
            {question.type === 'ox' && (
              <div className="ox">
                {question.options.map((o, i) => (
                  <button key={o.id} type="button" className={`${optionColor('ox', i, o.text)} ${mine?.value === o.id ? 'picked' : ''}`}
                    onClick={() => submit(o.id)}>{o.text}</button>
                ))}
              </div>
            )}
            {question.type === 'mc' && (
              <div className={`answers ${question.options.length > 4 ? 'many' : ''}`}>
                {question.options.map((o, i) => (
                  <button key={o.id} type="button" className={`${optionColor('mc', i)} ${mine?.value === o.id ? 'picked' : ''}`}
                    onClick={() => submit(o.id)}>
                    <span className="glyph">{GLYPHS[i % GLYPHS.length]}</span>
                    {o.image && <img src={mediaUrl(o.image)} alt="" />}
                    <span>{o.text || `보기 ${i + 1}`}</span>
                  </button>
                ))}
              </div>
            )}
            {question.type === 'short' && (
              <form className="short" onSubmit={e => { e.preventDefault(); if (shortValue.trim()) submit(shortValue.trim()); }}>
                <input maxLength={100} placeholder="정답 입력" autoComplete="off" value={shortValue}
                  onChange={e => setShortValue(e.target.value)} />
                <button className="btn btn--primary">{mine ? '답 바꾸기' : '제출'}</button>
              </form>
            )}
          </section>
        )}

        {view === 'result' && result && (
          <section className="view">
            <div className="center-stack">
              <div className={`stamp ${!result.answered ? 'stamp--wait' : result.correct ? 'stamp--ok' : 'stamp--no'}`}>
                {!result.answered ? '무응답' : result.correct ? (result.regraded ? '정답 처리됨' : '정답') : '오답'}
              </div>
              <div className="gain num">{result.gained > 0 ? '+' : ''}{result.gained}</div>
              <p className="rankline">현재 {result.tied && '공동 '}<b>{result.rank}</b>위 / {result.total}명</p>
              {(!result.correct && result.correctLabels.length > 0) || result.explanation ? (
                <div className="answer-note">
                  {!result.correct && result.correctLabels.length > 0 && (
                    <div>정답: <b>{result.correctLabels.join(', ')}</b></div>
                  )}
                  {result.explanation && <div>{result.explanation}</div>}
                </div>
              ) : null}
            </div>
          </section>
        )}

        {view === 'board' && rank && (
          <section className="view">
            <div className="center-stack">
              <p className="eyebrow">현재 순위</p>
              <div className="final-rank num">{rank.tied && <small>공동 </small>}{rank.rank}<small>위</small></div>
              <p className="rankline"><b>{rank.score}</b> 점</p>
              <p className="hint">다음 문제를 준비하세요</p>
            </div>
          </section>
        )}

        {view === 'end' && final && (
          <section className="view">
            <div className="center-stack">
              <div className="medal">{final.rank === 1 ? '🥇' : final.rank === 2 ? '🥈' : final.rank === 3 ? '🥉' : '🎉'}</div>
              <p className="eyebrow">최종 순위</p>
              <div className="final-rank num">{final.tied && <small>공동 </small>}{final.rank}<small>위</small></div>
              <p className="rankline"><b>{final.score}</b> 점 · {final.correctCount} / {final.totalQuestions} 문제 정답</p>
            </div>
          </section>
        )}

        {view === 'bye' && (
          <section className="view">
            <div className="center-stack">
              <div className="stamp stamp--no">{bye}</div>
              <button className="btn btn--primary btn--lg" onClick={() => setView('join')}>다시 입장하기</button>
            </div>
          </section>
        )}
      </div>

      {watching && view !== 'bye' && (
        <div className="watch">
          <div className="watch__icon">🎬</div>
          <b>앞 화면을 봐 주세요</b>
          <p>영상이 끝나면 퀴즈가 이어집니다</p>
        </div>
      )}
    </>
  );
}

/** 화면 꺼짐 방지 (HTTPS 에서만 동작) */
let wakeLock: { release: () => Promise<void> } | null = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await (navigator as any).wakeLock.request('screen');
      (wakeLock as any).addEventListener?.('release', () => { wakeLock = null; });
    }
  } catch {
    /* 지원하지 않으면 무시 */
  }
}
