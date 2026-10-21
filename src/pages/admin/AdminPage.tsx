import '../../styles/admin.css';

import { useEffect, useRef, useState } from 'react';
import { api, upload } from '../../lib/api';
import { getOperator, goLogin, logout } from '../../lib/auth';
import { mediaUrl } from '../../lib/config';
import { DEFAULT_THEME, PRESETS, applyTheme, normalize } from '../../lib/theme';
import { GLYPHS, TYPE_LABEL, toast } from '../../lib/ui';
import type { Question, QuestionType, Quiz, QuizSummary, Theme } from '../../lib/types';

/* ============================================================
   출제 화면 (운영자 PC) — 퀴즈 · 이미지 · 영상 · 색상 테마
   이미지와 영상은 S3 에 바로 올라가고, 저장해야 퀴즈에 반영된다.
   ============================================================ */

const COLORS = ['sig-1', 'sig-2', 'sig-3', 'sig-4', 'sig-5', 'sig-6'];
const LABEL_STYLE = { fontSize: 13, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 } as const;

function blankQ(type: QuestionType): Question {
  const q: Question = {
    type, text: '', image: '', points: 1000, explanation: '', options: [], answers: [],
    caseSensitive: false, ignoreSpaces: true, ignorePunctuation: false,
  };
  if (type === 'mc') q.options = [0, 1, 2, 3].map(i => ({ text: '', image: '', correct: i === 0 }));
  if (type === 'ox') q.options = [{ text: 'O', image: '', correct: true }, { text: 'X', image: '', correct: false }];
  return q;
}

export default function AdminPage() {
  const op = getOperator();
  const [list, setList] = useState<QuizSummary[]>([]);
  const [cur, setCur] = useState<Quiz | null>(null);
  const [dirty, setDirty] = useState(false);
  const [videoProgress, setVideoProgress] = useState<number | null>(null);
  const [closed, setClosed] = useState<Set<number>>(new Set());

  const filePicker = useRef<HTMLInputElement>(null);
  const pending = useRef<((url: string) => void) | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const curRef = useRef<Quiz | null>(null);
  curRef.current = cur;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  /** 편집 중인 퀴즈를 고친다 (사본을 만들어 바꾼 뒤 교체) */
  function mutate(fn: (q: Quiz) => void) {
    setCur(prev => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setDirty(true);
  }

  async function loadList() {
    try {
      setList(await api<QuizSummary[]>('/api/quizzes'));
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  async function openQuiz(id: number) {
    if (dirty && !confirm('저장하지 않은 변경사항이 있습니다. 그래도 이동할까요?')) return;
    try {
      setCur(await api<Quiz>(`/api/quizzes/${id}`));
      setDirty(false);
      setClosed(new Set());
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  async function save() {
    const q = curRef.current;
    if (!q) return;
    try {
      const saved = await api<Quiz>(`/api/quizzes/${q.id}`, { method: 'PUT', body: JSON.stringify(q) });
      setCur(saved);
      setDirty(false);
      await loadList();
      toast('저장했습니다.');
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  async function newQuiz() {
    if (dirty && !confirm('저장하지 않은 변경사항이 있습니다. 그래도 새로 만들까요?')) return;
    try {
      const created = await api<Quiz>('/api/quizzes', {
        method: 'POST', body: JSON.stringify({ title: '새 퀴즈', questions: [blankQ('mc')] }),
      });
      setCur(created);
      setDirty(false);
      await loadList();
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  async function removeQuiz() {
    if (!cur || !confirm(`'${cur.title}' 퀴즈를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try {
      await api(`/api/quizzes/${cur.id}`, { method: 'DELETE' });
      setCur(null);
      setDirty(false);
      await loadList();
      toast('삭제했습니다.');
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  async function duplicate() {
    if (!cur) return;
    try {
      setCur(await api<Quiz>(`/api/quizzes/${cur.id}/duplicate`, { method: 'POST' }));
      setDirty(false);
      await loadList();
      toast('복제했습니다.');
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  function exportJson() {
    if (!cur) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(cur, null, 2)], { type: 'application/json' }));
    a.download = `${cur.title.replace(/[\\/:*?"<>|]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** 기존 quizlive 의 JSON 내보내기 파일 · data/quizzes.json 도 그대로 받는다 */
  async function importJson(file: File) {
    try {
      const created = await api<Quiz[]>('/api/quizzes/import', { method: 'POST', body: await file.text() });
      await loadList();
      setCur(created[0]);
      setDirty(false);
      toast(`${created.length}개를 가져왔습니다.`);
    } catch (e) {
      toast('가져오기에 실패했습니다: ' + (e as Error).message, true);
    }
  }

  function pickImage(done: (url: string) => void) {
    pending.current = done;
    if (filePicker.current) {
      filePicker.current.value = '';
      filePicker.current.click();
    }
  }

  async function onImagePicked(file?: File) {
    const done = pending.current;
    pending.current = null;
    if (!file || !done) return;
    try {
      done(await upload('image', file));
      toast('이미지를 올렸습니다.');
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  async function onVideoPicked(file?: File) {
    const target = curRef.current;
    if (!file || !target) return;
    setVideoProgress(0);
    try {
      const url = await upload('video', file, setVideoProgress);
      if (curRef.current?.id !== target.id) return toast('올리는 사이 다른 퀴즈로 이동해서 목록에 넣지 않았습니다.', true);
      mutate(q => q.videos.push({ title: file.name.replace(/\.[^.]+$/, ''), url }));
      toast('영상을 올렸습니다. 저장해야 퀴즈에 반영됩니다.');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setVideoProgress(null);
    }
  }

  function setTheme(fn: (t: Theme) => void, preset = 'custom') {
    mutate(q => {
      const t = normalize(q.theme);
      fn(t);
      t.preset = preset;
      q.theme = t;
    });
  }

  useEffect(() => {
    if (cur && previewRef.current) applyTheme(cur.theme, previewRef.current);
  }, [cur]);

  useEffect(() => {
    if (!op) return;
    loadList();
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    };
    const onLeave = (e: BeforeUnloadEvent) => { if (dirtyRef.current) e.preventDefault(); };
    document.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onLeave);
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onLeave); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!op) {
    goLogin();
    return null;
  }

  const theme = cur ? normalize(cur.theme) : DEFAULT_THEME;

  return (
    <div className={`shell ${dirty ? 'dirty' : ''}`}>
      {/* 좌측: 퀴즈 목록 */}
      <aside className="side">
        <div className="side__head">
          <div className="side__brand">Quiz<em>Live</em> 출제</div>
          <nav className="side__nav">
            <a href="/host">진행 화면</a>
            <a href="/" target="_blank" rel="noopener">참여자 화면</a>
          </nav>
        </div>
        <div className="side__list">
          {list.map(q => (
            <button key={q.id} className={`qz ${cur?.id === q.id ? 'cur' : ''}`} onClick={() => openQuiz(q.id)}>
              <b>{q.title}</b>
              <small>{q.questionCount}문항{q.videoCount ? ` · 영상 ${q.videoCount}` : ''} · {new Date(q.updatedAt).toLocaleDateString('ko-KR')}</small>
            </button>
          ))}
          {!list.length && <p style={{ color: 'var(--dim)', fontSize: 13, padding: 12 }}>아직 퀴즈가 없습니다.</p>}
        </div>
        <div className="side__foot">
          <button className="btn btn--primary btn--block" onClick={newQuiz}>+ 새 퀴즈</button>
          <button className="btn btn--sm btn--ghost btn--block" style={{ marginTop: 8 }} onClick={() => { logout(); goLogin(); }}>
            로그아웃 ({op.username})
          </button>
        </div>
      </aside>

      {/* 우측: 편집 */}
      <main className="main">
        <div className="main__bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span className="dirty-dot" />
            <strong style={{ fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {cur?.title ?? '퀴즈를 선택하세요'}
            </strong>
            {cur && <span className="badge">{cur.questions.length}문항</span>}
          </div>
          <div className="actions">
            <button className="btn btn--sm" disabled={!cur} onClick={exportJson}>JSON 내보내기</button>
            <label className="btn btn--sm" style={{ cursor: 'pointer' }}>
              JSON 가져오기
              <input type="file" accept="application/json,.json" hidden onChange={e => e.target.files?.[0] && importJson(e.target.files[0])} />
            </label>
            <button className="btn btn--sm" disabled={!cur} onClick={duplicate}>복제</button>
            <button className="btn btn--sm btn--danger" disabled={!cur} onClick={removeQuiz}>삭제</button>
            <button className="btn btn--sm btn--primary" disabled={!cur || !dirty} onClick={save}>저장 (Ctrl+S)</button>
          </div>
        </div>

        <div className="main__scroll">
          <div className="wrap">
            {!cur && (
              <div className="empty">
                <h2>퀴즈를 만들어 보세요</h2>
                <p>왼쪽 아래 <b>+ 새 퀴즈</b> 버튼으로 시작합니다. 문항 수에는 제한이 없습니다.</p>
              </div>
            )}

            {cur && (
              <div>
                {/* 퀴즈 정보 */}
                <section className="card box">
                  <h3>퀴즈 정보</h3>
                  <label className="field">
                    <span>제목</span>
                    <input className="input" maxLength={120} value={cur.title} onChange={e => mutate(q => { q.title = e.target.value; })} />
                  </label>
                  <label className="field">
                    <span>설명 (진행자용 메모)</span>
                    <textarea className="textarea" maxLength={500} value={cur.description}
                      onChange={e => mutate(q => { q.description = e.target.value; })} />
                  </label>
                  <div className="grid-2">
                    <div className="field">
                      <span>타이틀 이미지 <small style={{ color: 'var(--dim)' }}>로비 · 입장 화면 상단</small></span>
                      <ImageSlot className="imgslot--title" url={cur.titleImage} hint="권장 1200×450"
                        onPick={() => pickImage(url => mutate(q => { q.titleImage = url; }))}
                        onClear={() => mutate(q => { q.titleImage = ''; })} />
                    </div>
                    <div className="field">
                      <span>배경 이미지 <small style={{ color: 'var(--dim)' }}>진행 · 참여 화면 전체</small></span>
                      <ImageSlot className="imgslot--bg" url={cur.backgroundImage} hint="권장 1920×1080"
                        onPick={() => pickImage(url => mutate(q => { q.backgroundImage = url; }))}
                        onClear={() => mutate(q => { q.backgroundImage = ''; })} />
                    </div>
                  </div>
                </section>

                {/* 영상 */}
                <section className="card box">
                  <h3>영상 <small style={{ color: 'var(--dim)', fontWeight: 400 }}>진행 화면의 버튼으로 관객 화면(빔프로젝터)에 재생합니다 · mp4 권장</small></h3>
                  {!cur.videos.length && <p style={{ color: 'var(--dim)', fontSize: 13, margin: '0 0 12px' }}>아직 올린 영상이 없습니다.</p>}
                  {cur.videos.map((v, i) => (
                    <div key={i} className="optrow">
                      <span className="num" style={{ color: 'var(--dim)', textAlign: 'center' }}>{i + 1}</span>
                      <input type="text" maxLength={100} placeholder="영상 제목 (진행 화면 버튼에 표시)" value={v.title}
                        onChange={e => mutate(q => { q.videos[i].title = e.target.value; })} />
                      <a className="btn btn--sm" href={mediaUrl(v.url)} target="_blank" rel="noopener" style={{ textDecoration: 'none' }}>미리보기</a>
                      <button className="icobtn danger" title="목록에서 빼기"
                        onClick={() => confirm(`'${v.title || '제목 없는 영상'}'을 목록에서 뺄까요?`) && mutate(q => { q.videos.splice(i, 1); })}>✕</button>
                    </div>
                  ))}
                  <label className="btn btn--sm" style={{ cursor: videoProgress === null ? 'pointer' : 'wait' }}>
                    {videoProgress === null ? '+ 영상 올리기' : `올리는 중 ${videoProgress}%`}
                    <input type="file" accept="video/mp4,video/webm" hidden disabled={videoProgress !== null}
                      onChange={e => { onVideoPicked(e.target.files?.[0]); e.target.value = ''; }} />
                  </label>
                </section>

                {/* 색상 테마 */}
                <section className="card box">
                  <h3>색상 테마 <small style={{ color: 'var(--dim)', fontWeight: 400 }}>진행 · 관객 · 참여자 화면에 함께 적용됩니다</small></h3>
                  <div className="preset-row">
                    {Object.entries(PRESETS).map(([key, p]) => (
                      <button key={key} className={`preset ${theme.preset === key ? 'on' : ''}`}
                        onClick={() => setTheme(t => { Object.assign(t, { ink: p.ink, stage: p.stage, chalk: p.chalk, accent: p.accent, sig: [...p.sig], bgDim: p.bgDim }); }, key)}>
                        <span className="preset__chips">
                          <i style={{ background: p.ink }} /><i style={{ background: p.accent }} />
                          <i style={{ background: p.sig[0] }} /><i style={{ background: p.sig[3] }} />
                        </span>
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <div className="swatches">
                    {(['ink', 'stage', 'chalk', 'accent'] as const).map((k, i) => (
                      <label key={k} className="sw">
                        <input type="color" value={theme[k]} onChange={e => setTheme(t => { t[k] = e.target.value; })} />
                        <span>{['배경', '카드·패널', '글자', '강조'][i]}</span>
                      </label>
                    ))}
                  </div>
                  <div className="section-sub">보기 색 <small>객관식 보기와 집계 막대에 순서대로 쓰입니다</small></div>
                  <div className="swatches">
                    {theme.sig.map((c, i) => (
                      <label key={i} className="sw">
                        <input type="color" value={c} onChange={e => setTheme(t => { t.sig[i] = e.target.value; })} />
                        <span>{i + 1}</span>
                      </label>
                    ))}
                  </div>
                  <label className="field" style={{ marginTop: 16 }}>
                    <span>배경 이미지 진하기 <b className="num">{Math.round(theme.bgDim * 100)}</b>%</span>
                    <input type="range" min={0} max={60} step={1} className="range" value={Math.round(theme.bgDim * 100)}
                      onChange={e => setTheme(t => { t.bgDim = Number(e.target.value) / 100; })} />
                  </label>
                  <div className="section-sub">미리보기</div>
                  <div className="theme-preview" ref={previewRef}>
                    <div className="tp-top"><span className="tp-eyebrow">문제 3 / 10</span></div>
                    <div className="tp-q">가장 큰 행성은 무엇일까요?</div>
                    <div className="tp-opts">
                      <span className="tp-opt sig-1">▲ 목성</span><span className="tp-opt sig-2">◆ 토성</span>
                      <span className="tp-opt sig-3">● 지구</span><span className="tp-opt sig-4">■ 화성</span>
                    </div>
                    <div className="tp-foot"><span className="tp-btn">다음 문제</span><span className="tp-muted">37명 제출</span></div>
                  </div>
                  <button className="btn btn--sm btn--ghost" style={{ marginTop: 14 }}
                    onClick={() => mutate(q => { q.theme = { ...DEFAULT_THEME, sig: [...DEFAULT_THEME.sig] }; })}>기본값으로 되돌리기</button>
                </section>

                {/* 문항 */}
                {cur.questions.map((q, i) => (
                  <QuestionCard key={i} q={q} i={i} count={cur.questions.length} closed={closed.has(i)}
                    toggle={() => setClosed(s => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
                    mutate={fn => mutate(z => fn(z.questions[i]))}
                    action={a => mutate(z => {
                      const qs = z.questions;
                      if (a === 'up' && i > 0) [qs[i - 1], qs[i]] = [qs[i], qs[i - 1]];
                      if (a === 'down' && i < qs.length - 1) [qs[i + 1], qs[i]] = [qs[i], qs[i + 1]];
                      if (a === 'dup') qs.splice(i + 1, 0, { ...structuredClone(qs[i]), id: null });
                      if (a === 'del') qs.splice(i, 1);
                      if (a.startsWith('type:')) {
                        const fresh = blankQ(a.slice(5) as QuestionType);
                        Object.assign(fresh, { text: qs[i].text, image: qs[i].image, points: qs[i].points, explanation: qs[i].explanation });
                        qs[i] = fresh;
                      }
                    })}
                    pickImage={pickImage} />
                ))}

                <div className="addq">
                  {(['mc', 'ox', 'short'] as const).map(t => (
                    <button key={t} className="btn" onClick={() => mutate(z => { z.questions.push(blankQ(t)); })}>+ {TYPE_LABEL[t]}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <input ref={filePicker} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden
        onChange={e => onImagePicked(e.target.files?.[0])} />
    </div>
  );
}

function ImageSlot({ url, className, hint, onPick, onClear }: {
  url: string; className: string; hint?: string; onPick: () => void; onClear: () => void;
}) {
  const src = mediaUrl(url);
  return (
    <div className={`imgslot ${className} ${src ? 'filled' : ''}`} style={src ? { backgroundImage: `url("${src}")` } : undefined}
      onClick={onPick}>
      <span className="ph">클릭해서 이미지 올리기{hint && <><br />{hint}</>}</span>
      <button className="clear" type="button" title="제거" onClick={e => { e.stopPropagation(); onClear(); }}>×</button>
    </div>
  );
}

function QuestionCard({ q, i, count, closed, toggle, mutate, action, pickImage }: {
  q: Question; i: number; count: number; closed: boolean; toggle: () => void;
  mutate: (fn: (q: Question) => void) => void; action: (a: string) => void; pickImage: (done: (url: string) => void) => void;
}) {
  const [answer, setAnswer] = useState('');
  return (
    <section className={`card qcard ${closed ? 'closed' : ''}`}>
      <div className="qcard__head" onClick={e => { if (!(e.target as HTMLElement).closest('.icobtn')) toggle(); }}>
        <span className="qcard__n">{i + 1}</span>
        <span className={`qcard__t ${q.text ? '' : 'ph'}`}>{q.text || '문제를 입력하세요'}</span>
        <span className="badge">{TYPE_LABEL[q.type]}</span>
        <span className="qcard__tools">
          <button className="icobtn" title="위로" disabled={i === 0} onClick={() => action('up')}>↑</button>
          <button className="icobtn" title="아래로" disabled={i === count - 1} onClick={() => action('down')}>↓</button>
          <button className="icobtn" title="복제" onClick={() => action('dup')}>⧉</button>
          <button className="icobtn danger" title="삭제" onClick={() => confirm(`${i + 1}번 문항을 삭제할까요?`) && action('del')}>✕</button>
        </span>
      </div>

      <div className="qcard__body">
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ ...LABEL_STYLE, marginBottom: 6 }}>유형</div>
            <div className="typeseg">
              {(['mc', 'ox', 'short'] as const).map(t => (
                <button key={t} className={q.type === t ? 'on' : ''} onClick={() => q.type !== t && action(`type:${t}`)}>{TYPE_LABEL[t]}</button>
              ))}
            </div>
          </div>
          <label className="field" style={{ margin: 0, width: 120 }}>
            <span>배점</span>
            <input className="input" type="number" min={0} max={10000} step={100} value={q.points}
              onChange={e => mutate(x => { x.points = Number(e.target.value); })} />
          </label>
        </div>

        <label className="field">
          <span>문제</span>
          <textarea className="textarea" maxLength={1000} placeholder="문제를 입력하세요" value={q.text}
            onChange={e => mutate(x => { x.text = e.target.value; })} />
        </label>

        <div className="field">
          <span>문제 이미지 (선택)</span>
          <ImageSlot className="imgslot--q" url={q.image}
            onPick={() => pickImage(url => mutate(x => { x.image = url; }))} onClear={() => mutate(x => { x.image = ''; })} />
        </div>

        {q.type === 'mc' && (
          <div>
            <div style={LABEL_STYLE}>보기 (정답을 하나 이상 체크하세요 · 복수정답 가능)</div>
            {q.options.map((o, oi) => (
              <div key={oi} className="optrow">
                <span className={`dot ${COLORS[oi % 6]}`} title={GLYPHS[oi % 6]} />
                <input type="text" maxLength={300} placeholder={`보기 ${oi + 1}`} value={o.text}
                  onChange={e => mutate(x => { x.options[oi].text = e.target.value; })} />
                <div className={`optimg ${o.image ? 'filled' : ''}`} style={o.image ? { backgroundImage: `url('${mediaUrl(o.image)}')` } : undefined}
                  onClick={() => (o.image && confirm('이 보기의 이미지를 지울까요?')
                    ? mutate(x => { x.options[oi].image = ''; })
                    : pickImage(url => mutate(x => { x.options[oi].image = url; })))}>
                  <span>+</span>
                </div>
                <label className={`corr ${o.correct ? 'on' : ''}`}>
                  <input type="checkbox" checked={o.correct} onChange={e => mutate(x => { x.options[oi].correct = e.target.checked; })} /> 정답
                </label>
                <button className="icobtn danger" title="보기 삭제"
                  onClick={() => (q.options.length <= 2 ? toast('보기는 2개 이상이어야 합니다.', true) : mutate(x => { x.options.splice(oi, 1); }))}>✕</button>
              </div>
            ))}
            <button className="btn btn--sm"
              onClick={() => (q.options.length >= 6 ? toast('보기는 최대 6개까지 넣을 수 있습니다.', true) : mutate(x => { x.options.push({ text: '', image: '', correct: false }); }))}>
              + 보기 추가
            </button>
          </div>
        )}

        {q.type === 'ox' && (
          <div>
            <div style={LABEL_STYLE}>정답</div>
            <div className="oxpick">
              {['O', 'X'].map(v => (
                <button key={v} className={q.options.find(o => o.text === v)?.correct ? 'on' : ''}
                  onClick={() => mutate(x => { x.options.forEach(o => { o.correct = o.text === v; }); })}>{v}</button>
              ))}
            </div>
          </div>
        )}

        {q.type === 'short' && (
          <div>
            <div style={LABEL_STYLE}>인정할 정답 (Enter로 추가 · 여러 개 등록 가능)</div>
            <div className="chips">
              {q.answers.map((a, ai) => (
                <span key={ai} className="chip">{a}<button onClick={() => mutate(x => { x.answers.splice(ai, 1); })}>×</button></span>
              ))}
              {!q.answers.length && <span style={{ color: 'var(--dim)', fontSize: 13 }}>등록된 정답이 없습니다</span>}
            </div>
            <input className="input" placeholder="정답을 입력하고 Enter" value={answer} onChange={e => setAnswer(e.target.value)}
              onKeyDown={e => {
                if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                e.preventDefault();
                const v = answer.trim();
                if (!v) return;
                if (q.answers.length >= 30) return toast('정답은 최대 30개까지 등록됩니다.', true);
                mutate(x => { x.answers.push(v); });
                setAnswer('');
              }} />
            <div className="togglerow">
              {([['ignoreSpaces', '띄어쓰기 무시'], ['caseSensitive', '영문 대소문자 구분'], ['ignorePunctuation', '문장부호 무시']] as const).map(([k, label]) => (
                <label key={k}><input type="checkbox" checked={q[k]} onChange={e => mutate(x => { x[k] = e.target.checked; })} /> {label}</label>
              ))}
            </div>
          </div>
        )}

        <label className="field" style={{ marginTop: 14 }}>
          <span>해설 (선택 · 정답 공개 시 함께 표시)</span>
          <textarea className="textarea" style={{ minHeight: 56 }} value={q.explanation}
            onChange={e => mutate(x => { x.explanation = e.target.value; })} />
        </label>
      </div>
    </section>
  );
}
