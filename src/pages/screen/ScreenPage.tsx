import '../../styles/host.css';
import '../../styles/screen.css';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Realtime } from '../../lib/realtime';
import { getOperator, goLogin, logout } from '../../lib/auth';
import { applyTheme } from '../../lib/theme';
import { joinUrl, mediaUrl } from '../../lib/config';
import { GLYPHS, TYPE_LABEL, optionColor, toast, toggleFullscreen } from '../../lib/ui';
import type { BoardRow, Ended, Playing, Progress, QuestionView, QuizMeta, Reveal, Tally } from '../../lib/types';
import { Podium, Row } from '../../components/Board';
import { qrDataUrl } from '../../lib/qr';

/* ============================================================
   관객 화면 (빔프로젝터) — 방을 만든 운영자 계정으로만 연다.
   받아서 보여주기만 하고, 영상은 연결되자마자 통째로 받아 둔다.
   ============================================================ */

type Scene = 'connect' | 'lobby' | 'question' | 'tally' | 'board' | 'end' | 'bye';

interface JoinReply {
  pin: string;
  quiz: QuizMeta;
  state: string;
  count: number;
  video: Playing | null;
  question: QuestionView | null;
  progress: Progress | null;
  reveal: Reveal | null;
  scoreboard: BoardRow[] | null;
  ended: Ended | null;
}

const LABEL: Record<Scene, string> = {
  connect: '연결 대기', lobby: '입장 대기', question: '답안 접수 중', tally: '정답 공개', board: '순위', end: '최종 결과', bye: '연결 종료',
};

export default function ScreenPage() {
  const op = getOperator();
  const rt = useMemo(() => new Realtime(op?.token), [op?.token]);
  const urlPin = new URLSearchParams(window.location.search).get('pin') ?? '';

  const [pinInput, setPinInput] = useState('');
  const [pin, setPin] = useState('');
  const [quiz, setQuiz] = useState<QuizMeta | null>(null);
  const [scene, setScene] = useState<Scene>('connect');
  const [count, setCount] = useState(0);
  const [question, setQuestion] = useState<QuestionView | null>(null);
  const [progress, setProgress] = useState<Progress>({ answered: 0, changed: 0, total: 0 });
  const [tally, setTally] = useState<Tally | null>(null);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [ended, setEnded] = useState<Ended | null>(null);
  const [byeMsg, setByeMsg] = useState('');
  const [qr, setQr] = useState('');
  const [videoBadge, setVideoBadge] = useState('');
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [needTap, setNeedTap] = useState(false);
  const [showQ, setShowQ] = useState(false);   // 문제 영상이 절반을 지나면 아래쪽에 문제를 띄운다

  const pinRef = useRef('');
  const playingRef = useRef<Playing | null>(null);
  const halfSent = useRef(false);
  const videoEl = useRef<HTMLVideoElement>(null);
  const videoSrc = useRef(new Map<string, string>());   // 영상 주소 → 미리 받아 둔 blob 주소
  const preloading = useRef(false);

  async function join(p: string) {
    try {
      const r = await rt.request<JoinReply>('screen.join', { pin: p });
      pinRef.current = r.pin;
      setPin(r.pin);
      rt.subscribe(`/topic/room.${r.pin}.screen`);
      setQuiz(r.quiz);
      applyTheme(r.quiz.theme);
      setCount(r.count);
      qrDataUrl(joinUrl(r.pin), 800).then(setQr).catch(() => setQr(''));
      preloadVideos(r.quiz.videoUrls ?? []);
      if (r.question) { setQuestion(r.question); setProgress(r.progress ?? progress); setScene('question'); }
      else if (r.reveal) { setTally(r.reveal.tally); setScene('tally'); }
      else if (r.scoreboard) { setBoard(r.scoreboard); setScene('board'); }
      else if (r.ended) { setEnded(r.ended); setScene('end'); }
      else setScene('lobby');
      playVideo(r.video);
    } catch (e) {
      toast((e as Error).message, true);
      setScene('connect');
    }
  }

  /* ---------- 영상: 미리 통째로 받아 두기 (행사 중 네트워크가 느려도 끊기지 않게) ---------- */
  async function preloadVideos(list: string[]) {
    if (preloading.current) return;
    preloading.current = true;
    for (const [i, url] of list.entries()) {
      if (videoSrc.current.has(url)) continue;
      try {
        const res = await fetch(mediaUrl(url));
        if (!res.ok || !res.body) throw new Error(String(res.status));
        const totalBytes = Number(res.headers.get('content-length')) || 0;
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          got += value.length;
          setVideoBadge(`영상 받는 중 ${i + 1}/${list.length}` + (totalBytes ? ` · ${Math.round((got / totalBytes) * 100)}%` : ''));
        }
        videoSrc.current.set(url, URL.createObjectURL(new Blob(chunks as BlobPart[], { type: res.headers.get('content-type') || 'video/mp4' })));
      } catch {
        /* 못 받은 영상은 재생할 때 주소에서 바로 받는다 */
      }
    }
    preloading.current = false;
    const ready = list.filter(u => videoSrc.current.has(u)).length;
    setVideoBadge(ready === list.length ? '' : `영상 ${ready}/${list.length} 준비됨`);
  }

  function playVideo(v: Playing | null) {
    if (v && v.seq === playingRef.current?.seq) return;   // 다시 연결돼도 보던 영상을 처음부터 다시 틀지 않는다
    playingRef.current = v;
    halfSent.current = false;
    setPlaying(v);
    setShowQ(false);
    setNeedTap(false);
    const el = videoEl.current;
    if (!el) return;
    if (!v) {
      el.pause();
      el.removeAttribute('src');
      el.load();
      return;
    }
    el.src = videoSrc.current.get(v.url) || mediaUrl(v.url);
    // 이 창에서 클릭 · 키 입력이 한 번도 없으면 브라우저가 소리 있는 자동재생을 막는다
    el.play().catch(() => setNeedTap(true));
  }

  /** 문제 영상이 절반을 지나면 문제를 띄우고 서버에 알린다 → 태블릿에 문제가 열린다 */
  function onVideoTime() {
    const v = playingRef.current, el = videoEl.current;
    if (!v || !el || v.kind !== 'question' || halfSent.current) return;
    // 길이 정보가 없는 영상(duration 이 Infinity)은 끝날 때 열린다
    if (Number.isFinite(el.duration) && el.currentTime >= el.duration / 2) {
      halfSent.current = true;
      setShowQ(true);
      rt.request('screen.videoHalf', { seq: v.seq }).catch(() => {});
    }
  }

  function onVideoEnded() {
    const v = playingRef.current;
    if (!v) return;
    // 마지막 장면에 멈춰 두면 서버가 다음 장면(1번 문제 · 퀴즈 화면 · 최종 순위)을 보낸다. 알리지 못하면 바로 내린다
    rt.request('screen.videoEnded', { seq: v.seq }).catch(() => playVideo(null));
  }

  /* ---------- 실시간 ---------- */
  useEffect(() => {
    if (!op) return;
    const off = [
      rt.on<{ count: number }>('room.players', d => setCount(d.count)),
      rt.on<{ count: number }>('room.join', d => setCount(d.count)),
      rt.on<{ count: number }>('room.leave', d => setCount(d.count)),
      rt.on<QuestionView>('game.question', q => {
        setQuestion(q);
        setProgress({ answered: 0, changed: 0, total: 0 });
        setScene('question');
      }),
      rt.on<Progress>('game.progress', d => { setProgress(d); setCount(d.total); }),
      rt.on<Reveal>('game.reveal', d => { setTally(d.tally); setScene('tally'); }),
      rt.on<{ scoreboard: BoardRow[] }>('game.scoreboard', d => { setBoard(d.scoreboard); setScene('board'); }),
      rt.on<Ended>('game.ended', d => { setEnded(d); setScene('end'); }),
      rt.on<{ video: Playing | null }>('game.video', d => playVideo(d.video)),
      rt.on<{ reason: string }>('game.closed', d => {
        playVideo(null);
        rt.unsubscribe(`/topic/room.${pinRef.current}.screen`);
        pinRef.current = '';
        setByeMsg(d.reason || '방이 종료되었습니다');
        setScene('bye');
      }),
    ];
    rt.onAuthError = () => { logout(); goLogin(); };
    rt.onReconnect = () => { if (pinRef.current) join(pinRef.current); };
    rt.start();
    if (/^\d{6}$/.test(urlPin)) join(urlPin);

    const onKey = (e: KeyboardEvent) => {
      if (/^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)) return;
      if (e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFullscreen(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { off.forEach(f => f()); document.removeEventListener('keydown', onKey); rt.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!op) {
    goLogin();
    return null;
  }

  const titleImage = mediaUrl(quiz?.titleImage);

  return (
    <>
      <div className="shell shell--solo">
        <main className="stage">
          <div className="stage__bg" style={quiz?.backgroundImage ? { backgroundImage: `url("${mediaUrl(quiz.backgroundImage)}")` } : undefined} />
          <div className="stage__top">
            <span className="eyebrow">{LABEL[scene]}</span>
            <div className="right">
              {pin && <span className="badge">PIN {pin}</span>}
              {pin && <span className="badge">{count}명 입장</span>}
              {videoBadge && <span className="badge">{videoBadge}</span>}
            </div>
          </div>

          {scene === 'connect' && (
            <section className="scene on">
              <div className="setup">
                <h1>관객 화면</h1>
                <p>진행 화면에 표시된 PIN을 입력하면 연결됩니다.</p>
                <form className="card quiz-picker" onSubmit={e => { e.preventDefault(); if (/^\d{6}$/.test(pinInput)) join(pinInput); else toast('PIN 6자리를 입력해 주세요.', true); }}>
                  <input className="pin-big num" inputMode="numeric" maxLength={6} placeholder="000000" autoComplete="off"
                    aria-label="6자리 PIN" value={pinInput} onChange={e => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))} />
                  <button className="btn btn--primary btn--lg btn--block" style={{ marginTop: 14 }}>연결하기</button>
                  <p style={{ margin: '14px 0 0', fontSize: 13, color: 'var(--dim)', lineHeight: 1.6 }}>
                    이 화면에는 조작 버튼이 없습니다. 문제와 정답 집계, 순위만 표시됩니다.<br />
                    방을 만든 운영자 계정으로만 열 수 있습니다.
                  </p>
                </form>
              </div>
            </section>
          )}

          {scene === 'lobby' && (
            <section className="scene on" id="s-lobby">
              <div className="lobby-center">
                <div className={`title-hero ${titleImage ? 'filled' : ''}`} style={titleImage ? { backgroundImage: `url("${titleImage}")` } : undefined}>
                  <span>타이틀 이미지</span>
                </div>
                <div className="join-hero">
                  {qr && <div className="qr-hero on"><img src={qr} alt="입장 QR 코드" /></div>}
                  <div className="pin-mini">
                    <span className="pin-mini__label">입장 PIN</span>
                    <div className="pin-tiles pin-tiles--sm">{[...pin].map((d, i) => <span key={i}>{d}</span>)}</div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {scene === 'question' && question && (
            <section className="scene on" id="s-question">
              <div className="q-hud">
                <div className={`submit-count ${progress.total > 0 && progress.answered >= progress.total ? 'done' : ''}`}>
                  <b className="num">{progress.answered}</b><span>제출 / {progress.total || count}</span>
                </div>
              </div>
              <div className="q-center">
                <p className="eyebrow">문제 {question.index + 1} / {question.total} · {TYPE_LABEL[question.type]}</p>
                <h1 className="q-big">{question.text}</h1>
                {question.image && <div className="q-media on"><img src={mediaUrl(question.image)} alt="" /></div>}
              </div>
              <QuestionOptions q={question} />
            </section>
          )}

          {scene === 'tally' && tally && (
            <section className="scene on" id="s-tally">
              <p className="tally-q">{tally.index + 1}. {tally.question}</p>
              <div className="answer-hero">
                <span className="answer-hero__label">정답</span>
                <div className="answer-hero__value">{tally.correctLabels.join(' / ') || '—'}</div>
                {tally.explanation && <p className="answer-hero__why">{tally.explanation}</p>}
              </div>
              <div className="tally-sum">
                <span className="ok">정답 <b className="num">{tally.correctCount}</b></span>
                <span className="no">오답 <b className="num">{tally.wrongCount}</b></span>
                <span className="na">무응답 <b className="num">{tally.noAnswer}</b></span>
              </div>
              {tally.type === 'short' ? (
                <div className="rows rows--screen">
                  {tally.buckets.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 22 }}>제출된 답이 없습니다.</p>}
                  {tally.buckets.slice(0, 12).map(b => (
                    <div key={b.key} className={`row ${b.correct ? 'ok' : ''}`}>
                      <div className="row__meter" style={{ width: `${Math.round((b.count / tally.max) * 100)}%` }} />
                      <div className="row__text">{b.label}</div>
                      <div className="row__n">{b.count}</div>
                      <div className="row__act" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bars bars--compact">
                  {tally.buckets.map((b, i) => (
                    <div key={b.key} className={`bar ${b.correct ? 'is-correct' : 'is-wrong'}`}>
                      <div className="bar__track">
                        <div className={`bar__fill ${optionColor(tally.type, b.index ?? i, b.label)}`}
                          style={{ height: `${Math.max(2, Math.round((b.count / tally.max) * 100))}%` }}>
                          <span className="bar__count">{b.count}</span>
                        </div>
                      </div>
                      <div className="bar__label" title={b.label}>{b.label}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {scene === 'board' && (
            <section className="scene scene-scroll on">
              <p className="eyebrow" style={{ marginBottom: 16 }}>현재 순위</p>
              <div className="board">{board.map(r => <Row key={r.id ?? r.displayName} r={r} />)}</div>
            </section>
          )}

          {scene === 'end' && ended && (
            <section className="scene on" id="s-end">
              <div className="final-head">
                <h1>퀴즈 종료</h1>
                <p className="final-note">
                  {ended.totalPlayers > ended.scoreboard.length ? `참여 ${ended.totalPlayers}명 중 상위 ${ended.shownTop}위` : `참여 ${ended.totalPlayers}명`}
                </p>
              </div>
              {/* 빔 화면은 스크롤할 수 없으므로 시상대와 상위 10명을 한 화면에. 공동 순위로 10명을 넘으면 2열 */}
              <div className="final-body">
                <Podium podium={ended.podium} />
                <FinalBoard ended={ended} />
              </div>
            </section>
          )}

          {scene === 'bye' && (
            <section className="scene on">
              <div className="setup">
                <h1>{byeMsg}</h1>
                <p>진행자가 새 방을 열면 PIN을 다시 입력해 주세요.</p>
                <button className="btn btn--primary" onClick={() => { setPinInput(''); setPin(''); setScene('connect'); }}>PIN 다시 입력</button>
              </div>
            </section>
          )}
        </main>
      </div>

      <div className="vstage" hidden={!playing}>
        <video ref={videoEl} playsInline onTimeUpdate={onVideoTime} onEnded={onVideoEnded} />
        {showQ && playing?.kind === 'question' && question && (
          <div className="vq">
            <p className="eyebrow">문제 {question.index + 1} / {question.total} · {TYPE_LABEL[question.type]}</p>
            <h2 className="vq__text">{question.text}</h2>
            <QuestionOptions q={question} />
          </div>
        )}
        {needTap && (
          <button className="vstage__tap" type="button" onClick={() => { setNeedTap(false); videoEl.current?.play(); }}>
            화면을 한 번 클릭하면 영상이 재생됩니다
          </button>
        )}
      </div>
    </>
  );
}

/** 최종 순위표: 줄 높이를 화면에 나눠 담는다 (10줄 기준, 넘치면 2열) */
function FinalBoard({ ended }: { ended: Ended }) {
  const n = ended.scoreboard.length;
  const twoCol = n > 10;
  const rows = twoCol ? Math.ceil(n / 2) : 10;
  return (
    <div className={`board ${twoCol ? 'two-col' : ''}`} style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
      {ended.scoreboard.map((r, i) => <Row key={i} r={r} gain={`${r.correctCount}/${ended.totalQuestions} 정답`} />)}
    </div>
  );
}

/** 문제 화면과 문제 영상 아래쪽에 함께 쓰는 보기 */
function QuestionOptions({ q }: { q: QuestionView }) {
  if (q.type === 'short') return <div className="short-hint">태블릿에 정답을 직접 입력하세요</div>;
  return (
    <div className={`opts-lg ${q.options.length <= 2 && q.type !== 'ox' ? 'one-col' : ''}`}>
      {q.options.map((o, i) => (
        <div key={o.id} className={`opt-lg ${optionColor(q.type, i, o.text)}`}>
          <span className="glyph">{q.type === 'ox' ? '' : GLYPHS[i % GLYPHS.length]}</span>
          {o.image && <img src={mediaUrl(o.image)} alt="" />}
          <span>{o.text}</span>
        </div>
      ))}
    </div>
  );
}
