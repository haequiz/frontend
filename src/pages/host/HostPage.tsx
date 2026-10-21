import '../../styles/host.css';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Realtime, type GameEvent } from '../../lib/realtime';
import { getOperator, goLogin, logout } from '../../lib/auth';
import { api, downloadResults } from '../../lib/api';
import { applyTheme } from '../../lib/theme';
import { joinUrl, mediaUrl } from '../../lib/config';
import { GLYPHS, TYPE_LABEL, optionColor, toast } from '../../lib/ui';
import { Podium, Row } from '../../components/Board';
import { qrDataUrl } from '../../lib/qr';
import type {
  BoardRow, Ended, PlayerList, PlayerRow, Progress, QuestionView, Quiz, QuizSummary, Reveal, Tally,
} from '../../lib/types';

/* ============================================================
   진행 화면 (운영자 PC) — 방을 만든 계정만 진행 · 영상 · 관객 화면을 쓴다
   ============================================================ */

type Phase = 'setup' | 'lobby' | 'question' | 'tally' | 'board' | 'end';

interface Room {
  pin: string;
  quiz: Quiz;
  maxPlayers: number;
}

interface ResumeReply extends Room {
  state: 'lobby' | 'question' | 'reveal' | 'scoreboard' | 'ended';
  qIndex: number;
  videoId: number | null;
  players: PlayerList;
  question: QuestionView | null;
  progress: Progress | null;
  reveal: Reveal | null;
  scoreboard: BoardRow[] | null;
  ended: Ended | null;
}

const STORE = 'haequiz.host';
const PHASE_LABEL: Record<Phase, string> = {
  setup: '준비', lobby: '입장 대기', question: '답안 접수 중', tally: '집계 결과', board: '순위', end: '최종 결과',
};

export default function HostPage() {
  const op = getOperator();
  const rt = useMemo(() => new Realtime(op?.token), [op?.token]);

  const [quizzes, setQuizzes] = useState<QuizSummary[] | null>(null);
  const [quizId, setQuizId] = useState<number | ''>('');
  const [room, setRoom] = useState<Room | null>(null);
  const [phase, setPhase] = useState<Phase>('setup');
  const [qIndex, setQIndex] = useState(-1);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [question, setQuestion] = useState<QuestionView | null>(null);
  const [progress, setProgress] = useState<Progress>({ answered: 0, changed: 0, total: 0 });
  const [tally, setTally] = useState<Tally | null>(null);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [ended, setEnded] = useState<Ended | null>(null);
  const [playingVideo, setPlayingVideo] = useState<number | null>(null);
  const [qr, setQr] = useState('');
  const [present, setPresent] = useState(false);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);

  const roomRef = useRef<Room | null>(null);
  roomRef.current = room;

  /* ---------- 방 열기 · 되살리기 ---------- */
  function openRoom(r: Room) {
    sessionStorage.setItem(STORE, JSON.stringify({ pin: r.pin }));
    setRoom(r);
    applyTheme(r.quiz.theme);
    qrDataUrl(joinUrl(r.pin)).then(setQr).catch(() => setQr(''));
  }

  async function resume(pin: string) {
    try {
      const r = await rt.request<ResumeReply>('host.resume', { pin });
      openRoom(r);
      setPlayers(r.players.list);
      setQIndex(r.qIndex);
      setPlayingVideo(r.videoId);
      if (r.state === 'question' && r.question) { setQuestion(r.question); setProgress(r.progress!); setPhase('question'); }
      else if (r.state === 'reveal' && r.reveal) { setTally(r.reveal.tally); setPhase('tally'); }
      else if (r.state === 'scoreboard' && r.scoreboard) { setBoard(r.scoreboard); setPhase('board'); }
      else if (r.state === 'ended' && r.ended) { setEnded(r.ended); setPhase('end'); }
      else setPhase('lobby');
    } catch (e) {
      sessionStorage.removeItem(STORE);
      toast((e as Error).message, true);
    }
  }

  async function createRoom() {
    if (!quizId) return toast('퀴즈를 선택해 주세요.', true);
    setBusy(true);
    try {
      const r = await rt.request<Room>('host.create', { quizId });
      openRoom(r);
      setPlayers([]);
      setQIndex(-1);
      setPlayingVideo(null);
      setPhase('lobby');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  /* ---------- 실시간 ---------- */
  useEffect(() => {
    if (!op) return;
    const mine = (ev: GameEvent) => ev.pin === roomRef.current?.pin;
    const off = [
      rt.on<PlayerList>('room.players', (d, ev) => mine(ev) && setPlayers(d.list)),
      rt.on<{ id: string; displayName: string }>('room.join', (d, ev) => mine(ev) &&
        setPlayers(ps => ps.some(p => p.id === d.id) ? ps : [...ps, { id: d.id, displayName: d.displayName, score: 0, online: true }])),
      rt.on<{ id: string }>('room.leave', (d, ev) => mine(ev) &&
        setPlayers(ps => ps.map(p => (p.id === d.id ? { ...p, online: false } : p)))),
      rt.on<QuestionView>('game.question', (q, ev) => {
        if (!mine(ev)) return;
        setQuestion(q);
        setQIndex(q.index);
        setProgress({ answered: 0, changed: 0, total: 0 });
        setPhase('question');
      }),
      rt.on<Progress>('game.progress', (d, ev) => mine(ev) && setProgress(d)),
      rt.on<Reveal>('game.reveal', (d, ev) => { if (mine(ev)) { setTally(d.tally); setPhase('tally'); } }),
      rt.on<{ scoreboard: BoardRow[] }>('game.scoreboard', (d, ev) => { if (mine(ev)) { setBoard(d.scoreboard); setPhase('board'); } }),
      rt.on<Ended>('game.ended', (d, ev) => { if (mine(ev)) { setEnded(d); setPhase('end'); } }),
      rt.on<{ video: { id: number } | null }>('game.video', (d, ev) => mine(ev) && setPlayingVideo(d.video?.id ?? null)),
      rt.on('game.closed', (_d, ev) => { if (mine(ev)) sessionStorage.removeItem(STORE); }),
    ];
    rt.subscribe('/user/queue/host');
    rt.onStatus = setOnline;
    rt.onAuthError = () => { logout(); goLogin(); };
    rt.onReconnect = () => { if (roomRef.current) resume(roomRef.current.pin); };   // 진행 권한을 되찾는다
    rt.start();

    const saved = JSON.parse(sessionStorage.getItem(STORE) || 'null');
    if (saved?.pin) resume(saved.pin);
    api<QuizSummary[]>('/api/quizzes').then(list => {
      setQuizzes(list);
      if (list.length) setQuizId(list[0].id);
    }).catch(e => toast(e.message, true));

    return () => { off.forEach(f => f()); rt.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = (type: string, body: object = {}) =>
    rt.request(type, body).catch(e => toast((e as Error).message, true));

  /* ---------- 버튼 · 단축키 ---------- */
  const total = room?.quiz.questions.length ?? 0;
  const isLast = qIndex >= total - 1;
  const can = {
    start: phase === 'lobby',
    endq: phase === 'question',
    board: phase === 'tally',
    next: phase === 'tally' || phase === 'board',
  };

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = e => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'f') { e.preventDefault(); togglePresent(); }
    if (k === 'e' && can.endq) { e.preventDefault(); send('host.endQuestion'); }
    if (k === 'b' && can.board) { e.preventDefault(); send('host.scoreboard'); }
    if (e.code === 'Space' || k === 'arrowright') {
      e.preventDefault();
      if (can.next) send('host.next');
      else if (can.start) send('host.start');
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  function togglePresent() {
    setPresent(p => {
      if (!p) document.documentElement.requestFullscreen?.().catch(() => {});
      else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      return !p;
    });
  }

  function openScreen() {
    if (!room) return;
    const w = window.open(`/screen?pin=${room.pin}`, 'haequiz-screen', 'width=1280,height=800,menubar=no,toolbar=no');
    if (!w) toast('팝업이 차단되었습니다. 주소를 직접 열어 주세요.', true);
    else toast('관객 화면을 열었습니다. 빔프로젝터 쪽으로 옮기고 F 키를 누르세요.');
  }

  async function closeRoom() {
    if (!confirm('방을 종료하면 모든 참여자의 연결이 끊깁니다. 종료할까요?')) return;
    await send('host.close');
    sessionStorage.removeItem(STORE);
    window.location.reload();
  }

  if (!op) {
    goLogin();
    return null;
  }

  const quiz = room?.quiz;
  const online_ = players.filter(p => p.online).length;

  return (
    <div className={`shell ${present ? 'present' : ''}`} id="shell">
      {/* ============ 좌측 제어 패널 ============ */}
      <aside className="panel">
        <div className="panel__head">
          <div className="panel__brand">Quiz<em>Live</em> 진행</div>
          <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="badge">PIN {room?.pin ?? '—'}</span>
            {room && phase !== 'end' && <span className="badge badge--live">LIVE</span>}
            {!online && <span className="badge" style={{ color: '#FF8DA3' }}>재연결 중</span>}
          </div>
        </div>

        <div className="panel__body">
          <div className="metrics">
            <div className="metric"><b className="num">{players.length}</b><span>참여자 (접속 {online_})</span></div>
            <div className="metric alert"><b className="num">{phase === 'question' ? progress.answered : 0}</b><span>제출</span></div>
          </div>

          <div className="section-label">진행</div>
          <div style={{ display: 'grid', gap: 8 }}>
            <button className="btn btn--primary" disabled={!can.start} onClick={() => send('host.start')}>퀴즈 시작</button>
            <button className={`btn ${progress.total > 0 && progress.answered >= progress.total ? 'btn--primary' : ''}`}
              disabled={!can.endq} onClick={() => send('host.endQuestion')}>답안 마감</button>
            <button className="btn" disabled={!can.board} onClick={() => send('host.scoreboard')}>순위 보기</button>
            <button className="btn btn--primary" disabled={!can.next} onClick={() => send('host.next')}>
              {phase === 'tally' && isLast ? '결과 발표' : '다음 문제'}
            </button>
          </div>

          {!!quiz?.videos.length && (
            <>
              <div className="section-label">영상 · 관객 화면에 재생</div>
              <div className="qnav">
                {quiz.videos.map(v => (
                  <button key={v.id} className={v.id === playingVideo ? 'cur' : ''}
                    onClick={() => send('host.video', { videoId: v.id })}>
                    <span className="n">{v.id === playingVideo ? '■' : '▶'}</span>
                    <span className="t">{v.title || '제목 없는 영상'}</span>
                  </button>
                ))}
              </div>
              <button className="btn btn--sm btn--block" style={{ marginTop: 6 }} disabled={!playingVideo}
                onClick={() => send('host.video', { videoId: null })}>■ 퀴즈 화면으로 돌아가기</button>
            </>
          )}

          {quiz && (
            <>
              <div className="section-label">문항</div>
              <div className="qnav">
                {quiz.questions.map((q, i) => (
                  <button key={i} className={i === qIndex ? 'cur' : i < qIndex ? 'done' : ''}
                    onClick={() => confirm(`${i + 1}번 문제로 이동할까요?`) && send('host.goto', { index: i })}>
                    <span className="n">{i + 1}</span>
                    <span className="t">{q.text || '(제목 없음)'}</span>
                    <span className="ty">{TYPE_LABEL[q.type]}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="section-label">참여자 {players.length > 0 && <span className="num">({players.length})</span>}</div>
          <div className="plist">
            {players.slice(0, 300).map(p => (
              <span key={p.id} className={`pchip ${p.online ? '' : 'off'}`}>
                {p.displayName}
                <button title="내보내기" onClick={() => confirm(`${p.displayName} 을(를) 내보낼까요?`) && send('host.kick', { participantId: p.id })}>×</button>
              </span>
            ))}
          </div>
        </div>

        <div className="panel__foot">
          <button className="btn btn--sm btn--primary" disabled={!room} onClick={openScreen}>관객 화면 열기</button>
          <button className="btn btn--sm" onClick={togglePresent}>발표 모드 (F)</button>
          <a className="btn btn--sm" href="/admin" style={{ textAlign: 'center', textDecoration: 'none' }}>출제 화면</a>
          <button className="btn btn--sm btn--danger" disabled={!room} onClick={closeRoom}>방 종료</button>
        </div>
      </aside>

      {/* ============ 우측 무대 ============ */}
      <main className="stage">
        <div className="stage__bg" style={quiz?.backgroundImage ? { backgroundImage: `url("${mediaUrl(quiz.backgroundImage)}")` } : undefined} />
        <div className="stage__top">
          <span className="eyebrow">{PHASE_LABEL[phase]}</span>
          <div className="right">
            <span className="badge">{quiz?.title ?? '퀴즈를 선택하세요'}</span>
            <button className="btn btn--sm btn--ghost" onClick={togglePresent}>전체화면</button>
          </div>
        </div>

        {phase === 'setup' && (
          <section className="scene on">
            <div className="setup">
              <h1>진행할 퀴즈를 고르세요</h1>
              <p>방을 만들면 6자리 PIN이 발급됩니다.</p>
              <div className="card quiz-picker">
                <label className="field">
                  <span>퀴즈</span>
                  <select className="select" value={quizId} onChange={e => setQuizId(Number(e.target.value))}>
                    {quizzes === null && <option>불러오는 중…</option>}
                    {quizzes?.length === 0 && <option value="">퀴즈가 없습니다 — 출제 화면에서 먼저 만드세요</option>}
                    {quizzes?.map(q => <option key={q.id} value={q.id}>{q.title} · {q.questionCount}문항</option>)}
                  </select>
                </label>
                <button className="btn btn--primary btn--lg btn--block" disabled={busy || !quizId} onClick={createRoom}>방 만들기</button>
                <p style={{ margin: '14px 0 0', fontSize: 13, color: 'var(--dim)' }}>
                  퀴즈를 새로 만들려면 <a href="/admin" style={{ color: 'var(--sig-2)' }}>출제 화면</a>으로 이동하세요.
                  {' · '}<a href="#" style={{ color: 'var(--dim)' }} onClick={e => { e.preventDefault(); logout(); goLogin(); }}>로그아웃</a>
                </p>
              </div>
            </div>
          </section>
        )}

        {phase === 'lobby' && room && (
          <section className="scene on">
            <div className="lobby">
              <div className="lobby__left">
                <div className={`title-slot-lg ${quiz?.titleImage ? 'filled' : ''}`}
                  style={quiz?.titleImage ? { backgroundImage: `url("${mediaUrl(quiz.titleImage)}")` } : undefined}>
                  <span>타이틀 이미지</span>
                </div>
                <div className="joinurl">태블릿으로 접속 → <b>{window.location.host}</b></div>
                <div className="joinurl" style={{ fontSize: 13, color: 'var(--dim)' }}>
                  관객 화면 → <b style={{ fontSize: 14 }}>{window.location.host}/screen?pin={room.pin}</b>
                </div>
                <div className="pin-tiles">{[...room.pin].map((d, i) => <span key={i}>{d}</span>)}</div>
                {qr && <div className="qr-box on"><img src={qr} alt="입장 QR 코드" /></div>}
              </div>
              <div className="lobby__right">
                <div className="lobby__count"><b>{players.length}</b> 명 입장 · 최대 {room.maxPlayers}명</div>
                <div className="namewall">{players.slice(-120).map(p => <span key={p.id}>{p.displayName}</span>)}</div>
              </div>
            </div>
          </section>
        )}

        {phase === 'question' && question && (
          <section className="scene on">
            <div className="q-meta">
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="eyebrow">문제 {question.index + 1} / {question.total} · {TYPE_LABEL[question.type]}</p>
                <h1 className="q-title">{question.text}</h1>
              </div>
              <div className={`submit-count ${progress.total > 0 && progress.answered >= progress.total ? 'done' : ''}`}>
                <b className="num">{progress.answered}</b>
                <span>제출 / {progress.total || players.length}</span>
                {progress.changed > 0 && <i>답 바꿈 <b className="num">{progress.changed}</b></i>}
              </div>
            </div>
            <div className="q-body">
              {question.image && <div className="q-media on"><img src={mediaUrl(question.image)} alt="" /></div>}
              {question.type === 'short' ? (
                <div className="short-hint">참여자가 태블릿에 정답을 직접 입력합니다</div>
              ) : (
                <div className={`opts-lg ${question.options.length <= 2 && question.type !== 'ox' ? 'one-col' : ''}`}>
                  {question.options.map((o, i) => (
                    <div key={o.id} className={`opt-lg ${optionColor(question.type, i, o.text)}`}>
                      <span className="glyph">{question.type === 'ox' ? '' : GLYPHS[i % GLYPHS.length]}</span>
                      {o.image && <img src={mediaUrl(o.image)} alt="" />}
                      <span>{o.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {phase === 'tally' && tally && (
          <section className="scene on">
            <div className="tally-head">
              <h2>{tally.index + 1}. {tally.question}</h2>
              <div className="tally-sum">
                <span className="ok">정답 <b className="num">{tally.correctCount}</b></span>
                <span className="no">오답 <b className="num">{tally.wrongCount}</b></span>
                <span className="na">무응답 <b className="num">{tally.noAnswer}</b></span>
              </div>
            </div>
            <div className="answer-strip">정답 <span>{tally.correctLabels.join(' / ') || '—'}</span>
              {tally.explanation && <em>{tally.explanation}</em>}
            </div>
            {tally.type === 'short' ? (
              <div className="rows">
                {tally.buckets.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 18 }}>제출된 답이 없습니다.</p>}
                {tally.buckets.map(b => (
                  <div key={b.key} className={`row ${b.correct ? 'ok' : ''}`}>
                    <div className="row__meter" style={{ width: `${Math.round((b.count / tally.max) * 100)}%` }} />
                    <div className="row__text">{b.label}</div>
                    <div className="row__n">{b.count}</div>
                    <div className="row__act">
                      <button className={`btn btn--sm ${b.correct ? 'btn--danger' : ''}`}
                        onClick={() => send('host.regrade', { key: b.key, correct: !b.correct })}>
                        {b.correct ? '오답 처리' : '정답 처리'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bars">
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

        {phase === 'board' && (
          <section className="scene scene-scroll on">
            <p className="eyebrow" style={{ marginBottom: 16 }}>현재 순위</p>
            <div className="board">{board.map(r => <Row key={r.id ?? r.displayName} r={r} />)}</div>
          </section>
        )}

        {phase === 'end' && ended && room && (
          <section className="scene scene-scroll on">
            <h1 style={{ textAlign: 'center', fontSize: 34, marginBottom: 26 }}>퀴즈 종료</h1>
            <p className="final-note">
              {ended.totalPlayers > ended.scoreboard.length ? `참여 ${ended.totalPlayers}명 중 상위 ${ended.shownTop}위` : `참여 ${ended.totalPlayers}명`}
            </p>
            <Podium podium={ended.podium} />
            <div className="board">
              {ended.scoreboard.map((r, i) => <Row key={i} r={r} gain={`${r.correctCount}/${ended.totalQuestions} 정답`} />)}
            </div>
            <div style={{ textAlign: 'center', marginTop: 24, display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button className="btn" onClick={() => downloadResults(room.pin).catch(e => toast(e.message, true))}>결과 CSV 내려받기</button>
              <button className="btn btn--ghost" onClick={() => { sessionStorage.removeItem(STORE); window.location.reload(); }}>새 퀴즈 진행</button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
