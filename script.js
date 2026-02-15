const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
// ===== Mobile tools menu =====
(function setupMobileToolsMenu() {
  const btnTools = document.getElementById('btnTools');
  const menu = document.getElementById('toolMenu');
  const mLoadJson = document.getElementById('mLoadJson');
  const mLoadTextbook = document.getElementById('mLoadTextbook');
  const mTheme = document.getElementById('mTheme');
  const mHelp = document.getElementById('mHelp');

  if (!btnTools || !menu) return;

  const closeMenu = () => menu.classList.remove('show');
  const toggleMenu = () => menu.classList.toggle('show');

  btnTools.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  // Actions
  mLoadJson?.addEventListener('click', () => {
    closeMenu();
    $('#fileInput').click();
  });
  mLoadTextbook?.addEventListener('click', () => {
    closeMenu();
    openTextbookImporter();
  });
  mTheme?.addEventListener('click', () => {
    closeMenu();
    toggleTheme();
  });
  mHelp?.addEventListener('click', () => {
    closeMenu();
    document.getElementById('btnHelp')?.click();
  });

  // Click outside to close
  document.addEventListener('click', (e) => {
    const overlay = document.getElementById('tourOverlay');
    const overlayOpen = overlay && getComputedStyle(overlay).display !== 'none';
    if (overlayOpen) return;

    if (!menu.contains(e.target) && e.target !== btnTools) closeMenu();
  });

  // Close on resize (vd xoay màn hình)
  window.addEventListener('resize', closeMenu);
})();

(() => {
  const box = document.getElementById('qChoices');
  if (!box) return;

  box.addEventListener(
    'pointerdown',
    (e) => {
      const choice = e.target.closest('.choice');
      if (!choice) return;

      const index = Number(choice.dataset.choice);
      if (Number.isFinite(index)) selectChoice(index);
    },
    { passive: true }
  );
})();

function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

const strip = (s) =>
  (s ?? '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

// ===== TEXTBOOK IMPORTER (TXT/MD/HTML -> JSON quiz) =====
let __generatedQuizzes = null; // array of quizzes compatible with handleData()

function openTextbookImporter() {
  $('#importerModal').style.display = 'flex';
  $('#importerReport').textContent = '👉 Dán nội dung hoặc chọn file, rồi bấm "Tạo quiz JSON".';
}
function closeTextbookImporter() {
  $('#importerModal').style.display = 'none';
}
function importerPasteExample() {
  $('#textbookArea').value = `CHƯƠNG 1: Mở đầu
1) Câu 1 là gì?
A. Đáp án A
B. Đáp án B
C. Đáp án C
D. Đáp án D
Đáp án: B
Giải thích: Vì ...

2) Câu 2 ...
A) ...
B) ...
C) ...
D) ...
Đáp án: A

CHƯƠNG 2: ...
1. Câu ...
A. ...
B. ...
C. ...
D. ...
Đáp án: D`;
}

$('#textbookInput').onchange = (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    $('#textbookArea').value = String(r.result || '');
    openTextbookImporter();
    $('#importerReport').textContent = `✅ Đã nạp file: ${f.name}. Bấm "Tạo quiz JSON".`;
  };
  r.readAsText(f, 'utf-8');
  e.target.value = '';
};

function normalizeLines(raw) {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00A0/g, ' ')
    .split('\n');
}

function parseTextbookToQuizzes(raw, opts = {}) {
  const { splitByChapter = true, keepAnswerInExplanation = true } = opts;

  const lines = normalizeLines(raw);

  const reChapter = /^\s*(?:ch(?:ươ|u)ơng|chapter)\s*([0-9]+)\s*[:\-.]?\s*(.*)$/i;
  const reQStart = /^\s*(\d{1,4})\s*[\$\.\:\-]\s*(.+)$/; // "1) ..." or "1. ..."
  const reChoice = /^\s*([A-D])\s*[\$\.\:\-]\s*(.+)$/i;
  const reAnswer =
    /^\s*(?:đáp\s*án|dap\s*an|ans(?:wer)?)\s*[:\-–=]*\s*([A-D](?:\s*(?:,|\/|và|and)\s*[A-D])*)\s*$/i;
  const reExplain = /^\s*(?:giải\s*thích|giai\s*thich|explain(?:ation)?)\s*[:\-–=]*\s*(.*)$/i;

  function newQuiz(title) {
    return { title: title || 'Bộ câu hỏi', timeLimit: 0, questions: [] };
  }

  // -------------------------
  // PASS 1: scan questions/choices/explanations; answers may be missing
  // -------------------------
  let quizzes = [];
  let curQuiz = newQuiz();
  let curQ = null;
  let pendingExplain = [];

  const idxMap = { A: 0, B: 1, C: 2, D: 3 };

  function normalizeAnswerRaw(rawAns) {
    const letters = String(rawAns || '')
      .toUpperCase()
      .split(/[,\/]|và|and/i)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => /^[A-D]$/.test(s));
    if (!letters.length) return null;
    const arr = [...new Set(letters.map((l) => idxMap[l]))].sort((a, b) => a - b);
    return arr.length === 1 ? arr[0] : arr;
  }

  function flushQuestion() {
    if (!curQ) return;

    if (pendingExplain.length) {
      const exp = pendingExplain.join('\n').trim();
      if (exp) curQ.explanation = curQ.explanation ? curQ.explanation + '\n' + exp : exp;
      pendingExplain = [];
    }

    // minimal validation: must have text + >=2 choices
    if (!curQ.text || !Array.isArray(curQ.choices) || curQ.choices.length < 2) {
      curQ = null;
      return;
    }

    // keep raw answer if missing; DO NOT force answer=0 here
    if (curQ.answer == null && keepAnswerInExplanation && curQ._rawAnswer) {
      curQ.explanation =
        (curQ.explanation ? curQ.explanation + '\n' : '') + `Đáp án (thô): ${curQ._rawAnswer}`;
    }
    delete curQ._rawAnswer;

    curQuiz.questions.push(curQ);
    curQ = null;
  }

  function flushQuizIfHasQuestions() {
    flushQuestion();
    if (curQuiz.questions.length) quizzes.push(curQuiz);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // chapter split
    const mCh = reChapter.exec(line);
    if (mCh && splitByChapter) {
      flushQuizIfHasQuestions();
      const chapNum = mCh[1];
      const chapName = (mCh[2] || '').trim();
      curQuiz = newQuiz(`Chương ${chapNum}${chapName ? ': ' + chapName : ''}`);
      continue;
    }
    const mQ = reQStart.exec(line);
    if (mQ) {
      flushQuestion();
      const qno = Number(mQ[1]);
      curQ = {
        _qno: Number.isFinite(qno) ? qno : null,
        text: mQ[2].trim(),
        choices: [],
        answer: null, // number | number[] | null
        explanation: '',
      };
      pendingExplain = [];
      continue;
    }

    if (!curQ) continue;

    // choice
    const mC = reChoice.exec(line);
    if (mC) {
      curQ.choices.push(mC[2].trim());
      continue;
    }

    // answer line (explicit)
    const mA = reAnswer.exec(line);
    if (mA) {
      const rawAns = mA[1].toUpperCase().trim();
      curQ._rawAnswer = rawAns;
      const ans = normalizeAnswerRaw(rawAns);
      if (ans != null) curQ.answer = ans;
      continue;
    }

    // explanation
    const mE = reExplain.exec(line);
    if (mE) {
      const rest = (mE[1] || '').trim();
      if (rest) pendingExplain.push(rest);
      continue;
    }

    // other lines: append to question text if no choices yet; else to explanation
    if (curQ.choices.length === 0 && curQ.text) {
      curQ.text += '\n' + line;
    } else {
      pendingExplain.push(line);
    }
  }

  flushQuizIfHasQuestions();

  // Assign stable ids
  let runningId = 0;
  quizzes.forEach((qz) =>
    qz.questions.forEach((q) => {
      if (q._id == null) q._id = runningId++;
    })
  );

  // -------------------------
  // PASS 2: If many answers missing, try to parse answer key at end: "1.A 2.B ..." / "1-A 2-C ..."
  // -------------------------
  const allQuestions = quizzes.flatMap((qz) => qz.questions);
  const missing = allQuestions.filter((q) => q.answer == null).length;

  if (missing > 0) {
    const ansMap = extractAnswerKeyFromTail(lines);
    if (ansMap.size) {
      for (const q of allQuestions) {
        if (q.answer != null) continue;
        if (q._qno == null) continue;
        const raw = ansMap.get(q._qno);
        if (!raw) continue;
        const ans = normalizeAnswerRaw(raw);
        if (ans != null) q.answer = ans;
      }
    }
  }

  // Finalize: for any still-missing answer, set 0 so app works (but mark in explanation)
  for (const q of allQuestions) {
    if (q.answer == null) {
      if (keepAnswerInExplanation) {
        q.explanation =
          (q.explanation ? q.explanation + '\n' : '') + '⚠️ Thiếu đáp án: mặc định chấm A.';
      }
      q.answer = 0;
    }
  }

  // cleanup internal fields
  quizzes.forEach((qz) =>
    qz.questions.forEach((q) => {
      delete q._qno;
    })
  );

  return quizzes;

  // ---- helper: extract answer key from tail ----
  function extractAnswerKeyFromTail(linesArr) {
    const map = new Map(); // qno -> "A" or "A,B"
    const maxScan = 250; // scan up to last 250 non-empty lines
    let scanned = 0;
    let foundAny = false;

    // regex finds multiple pairs per line
    const pairRe = /(\d{1,4})\s*[\.\-\$\:\s]\s*([A-D])\b/gi;

    for (let i = linesArr.length - 1; i >= 0 && scanned < maxScan; i--) {
      const ln = String(linesArr[i] || '').trim();
      if (!ln) continue;
      scanned++;

      let m;
      let localCount = 0;
      pairRe.lastIndex = 0;
      while ((m = pairRe.exec(ln)) !== null) {
        const qno = Number(m[1]);
        const letter = m[2].toUpperCase();
        if (!Number.isFinite(qno)) continue;
        // accumulate if repeated => multi-answer (rare, but support)
        const prev = map.get(qno);
        map.set(qno, prev ? `${prev},${letter}` : letter);
        localCount++;
      }

      if (localCount >= 3) foundAny = true;

      // Heuristic stop: once we've found a dense block and then encounter a line with no pairs, stop scanning
      if (foundAny && localCount === 0) break;
    }

    return map;
  }
}

function importerParse() {
  const raw = $('#textbookArea').value || '';
  if (!raw.trim()) {
    $('#importerReport').textContent = '❌ Chưa có nội dung để parse.';
    return;
  }

  const splitByChapter = $('#splitByChapter').checked;
  const keepAnswerInExplanation = $('#keepAnswerInExplanation').checked;

  const quizzes = parseTextbookToQuizzes(raw, { splitByChapter, keepAnswerInExplanation });

  if (!quizzes.length) {
    __generatedQuizzes = null;
    $('#btnDownloadGenerated').disabled = true;
    $('#importerReport').textContent =
      '❌ Không parse được câu hỏi. Gợi ý: đảm bảo có dạng "1) ...", lựa chọn "A. ...", và dòng "Đáp án: B".';
    return;
  }

  __generatedQuizzes = quizzes;
  $('#btnDownloadGenerated').disabled = false;

  const totalQ = quizzes.reduce((s, qz) => s + (qz.questions?.length || 0), 0);
  const titles = quizzes
    .slice(0, 5)
    .map((qz) => `• ${qz.title} (${qz.questions.length} câu)`)
    .join('\n');
  $('#importerReport').textContent =
    `✅ Tạo được ${quizzes.length} bộ / ${totalQ} câu.\n${titles}${quizzes.length > 5 ? '\n• ...' : ''}\n\n` +
    `Bạn có thể "Tải JSON" hoặc nạp thẳng vào app để làm bài.`;

  if ($('#autoLoadAfterParse').checked) {
    handleData(quizzes);
    closeTextbookImporter();
    $('#statusMessage').innerHTML =
      `Đã tạo từ giáo trình: <b>${sanitizeHTML(quizzes[0]?.title || 'Bộ câu hỏi')}</b>. Bấm Bắt đầu ngay!`;
  }
}

function downloadGeneratedJSON() {
  if (!__generatedQuizzes) return;
  const blob = new Blob([JSON.stringify(__generatedQuizzes, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'generated-quiz.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

// ===== SEARCH INDEX (pre-strip 1 lần khi nạp JSON) =====
let searchIndex = [];
// searchIndex[qz] = { titleN: "...", q: [ { textN:"", choicesN:[...], expN:"" } ] }

function buildSearchIndex(quizzes) {
  searchIndex = quizzes.map((qz) => ({
    titleN: strip(qz.title || ''),
    q: (qz.questions || []).map((qq) => ({
      textN: strip(qq.text || ''),
      choicesN: (qq.choices || []).map((c) => strip(c || '')),
      expN: strip(qq.explanation || ''),
    })),
  }));
}
function questionMatches(qzIndex, i) {
  const k = searchKeywordN; // ✅ đã strip sẵn
  if (!k) return true;

  const qi = searchIndex[qzIndex]?.q?.[i];
  if (!qi) return true;

  return qi.textN.includes(k) || qi.expN.includes(k) || qi.choicesN.some((x) => x.includes(k));
}

// ===== MATHJAX OPTIMIZED RENDER (WAIT STARTUP) =====
let mathRenderTimer = null;
let mathTypesetChain = Promise.resolve(); // khóa hàng đợi typeset

function toMathTargets(target) {
  if (!target) return [];
  return Array.isArray(target) ? target.filter(Boolean) : [target];
}

function whenMathJaxReady() {
  if (!window.MathJax) return Promise.resolve();
  if (MathJax.startup && MathJax.startup.promise) return MathJax.startup.promise;
  return Promise.resolve();
}

function renderMath(target) {
  if (!window.MathJax) return;
  const els = toMathTargets(target);
  if (!els.length) return;

  mathTypesetChain = mathTypesetChain
    .then(() => whenMathJaxReady())
    .then(() => MathJax.typesetPromise(els))
    .catch(() => {});
}

function renderMathDebounced(target, delay = 50) {
  if (!window.MathJax) return;
  const els = toMathTargets(target);
  if (!els.length) return;

  clearTimeout(mathRenderTimer);
  mathRenderTimer = setTimeout(() => {
    // serialize để không typeset chồng lên nhau
    mathTypesetChain = mathTypesetChain
      .then(() => whenMathJaxReady())
      .then(() => MathJax.typesetPromise(els))
      .catch(() => {});
  }, delay);
}
function typesetAndThen(targets, done) {
  if (!window.MathJax) {
    done?.();
    return;
  }
  const els = toMathTargets(targets);
  if (!els.length) {
    done?.();
    return;
  }

  mathTypesetChain = mathTypesetChain
    .then(() => whenMathJaxReady())
    .then(() => MathJax.typesetPromise(els))
    .catch(() => {})
    .finally(() => done?.());
}

const API_BASE = 'https://quizct11.onrender.com';

// ---- AI Explain cache & prefetch ----
const aiExplainCache = new Map(); // key -> { html, raw, ts }
const aiExplainInflight = new Map(); // key -> Promise

function aiCacheKey(q, userAns) {
  const qid = (q && (q._id ?? q.id ?? q.qid ?? '')) + '';
  const ua = Array.isArray(userAns)
    ? userAns
        .slice()
        .sort((a, b) => a - b)
        .join(',')
    : String(userAns ?? '');
  return `${qid}|${ua}`;
}

function normalizeUserAnswerForAI(userAns) {
  if (Array.isArray(userAns)) return userAns.slice().sort((a, b) => a - b);
  return userAns ?? null;
}
// Attempt to stream text if server supports it; fallback to JSON
async function fetchAIExplain({ q, userAnsIndex, correctAnsIndex, onChunk, timeoutMs = 12000 }) {
  const payload = {
    question: q.text,
    choices: q.choices,
    userAnswerIndex: normalizeUserAnswerForAI(userAnsIndex),
    correctAnswerIndex: correctAnsIndex,
    teacherExplanation: q.explanation || '',
  };

  const res = await fetchWithTimeout(
    `${API_BASE}/api/explain`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Hint streaming if backend supports it (safe even if ignored)
        Accept: 'text/plain, text/event-stream, application/json',
      },
      body: JSON.stringify(payload),
    },
    timeoutMs
  );

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const ct = (res.headers.get('content-type') || '').toLowerCase();

  // If JSON => standard response
  if (ct.includes('application/json')) {
    const data = await res.json();
    return String(data.explanation || '');
  }

  // Otherwise, treat as stream/text
  if (!res.body || !onChunk) {
    const t = await res.text();
    return String(t || '');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let full = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    full += chunk;
    onChunk(chunk, full);
  }
  return full;
}

function renderAIBox(htmlOrText, { streaming = false } = {}) {
  const box = $('#explain');
  if (streaming) {
    // streaming: update progressively, do NOT typeset every chunk too aggressively
    box.innerHTML = `<b>AI giải thích:</b><br>${sanitizeHTML(htmlOrText)}`;
  } else {
    box.innerHTML = `<b>AI giải thích:</b><br>${sanitizeHTML(htmlOrText)}`;
    renderMathDebounced(box, 60);
  }
}

async function getAIExplainCached(q, userAnsIndex, correctAnsIndex, { streamToBox = false } = {}) {
  const key = aiCacheKey(q, userAnsIndex);

  if (aiExplainCache.has(key)) {
    return aiExplainCache.get(key).raw;
  }
  if (aiExplainInflight.has(key)) {
    return aiExplainInflight.get(key);
  }

  const p = (async () => {
    const raw = await fetchAIExplain({
      q,
      userAnsIndex,
      correctAnsIndex,
      onChunk: streamToBox
        ? (chunk, full) => {
            renderAIBox(full, { streaming: true });
          }
        : null,
    });
    aiExplainCache.set(key, { raw, ts: Date.now() });
    return raw;
  })().finally(() => {
    aiExplainInflight.delete(key);
  });

  aiExplainInflight.set(key, p);
  return p;
}

// Prefetch (silent)
function prefetchAIExplain(q, userAnsIndex) {
  if (!q || !quiz) return;
  const correctAnsIndex = q.answer;
  // Don't stream during prefetch
  getAIExplainCached(q, userAnsIndex, correctAnsIndex, { streamToBox: false }).catch(() => {});
}

$('#btnAIExplain').onclick = async () => {
  const btn = $('#btnAIExplain');
  if (!quiz) return;

  const q = quiz.questions[idx];
  const userAnsIndex = answers[idx]?.value ?? null;
  const correctAnsIndex = q.answer;

  // immediate cache hit => instant UI
  const key = aiCacheKey(q, userAnsIndex);
  if (aiExplainCache.has(key)) {
    renderAIBox(aiExplainCache.get(key).raw, { streaming: false });
    return;
  }

  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Đang hỏi AI...';
  $('#explain').textContent = '⏳ Đang tải giải thích...';

  try {
    // Streaming UI if backend supports streaming; else fallback to JSON
    const raw = await getAIExplainCached(q, userAnsIndex, correctAnsIndex, { streamToBox: true });
    // final render + MathJax (mượt hơn)
    renderAIBox(raw, { streaming: false });
  } catch (e) {
    $('#explain').textContent = '❌ Lỗi khi gọi AI: ' + (e?.message || e);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
};
let allQuizzes = [],
  quiz = null,
  idx = 0,
  answers = [],
  timerId = null,
  wrongStreak = 0;
let subjects = []; // sẽ chứa meta: [{ name, file, quizzes? }]
let currentSubjectIndex = 0; // môn đang chọn

let questionFilter = 'all'; // all | bookmark | wrong
let autoNextTimer = null;
let lastWrongKey = '';
let sheepOpen = false;

const EXAM_TITLE_PREFIX = '📝 Đề thi ngẫu nhiên';

function clampInt(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) n = min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickRandom(arr, k) {
  const copy = arr.slice();
  shuffleInPlace(copy);
  return copy.slice(0, Math.max(0, Math.min(k, copy.length)));
}

/**
 * Tạo quiz mới từ 3 chương (allQuizzes[0..2]) theo % và tổng câu.
 * Không đụng vào dữ liệu gốc.
 */
function createExamQuiz({ total = 60, percents = [10, 45, 45] } = {}) {
  if (!Array.isArray(allQuizzes) || allQuizzes.length < 1) {
    throw new Error('Chưa có dữ liệu quiz.');
  }

  // Mặc định lấy 3 chương đầu nếu có
  const findChap = (n) =>
    allQuizzes.findIndex((q) => (q?.title || '').toLowerCase().includes(`chương ${n}`));
  let c1 = findChap(1),
    c2 = findChap(2),
    c3 = findChap(3);
  let chapters = [c1, c2, c3].filter(
    (i) => i >= 0 && allQuizzes[i] && Array.isArray(allQuizzes[i].questions)
  );

  if (chapters.length === 0) {
    chapters = [0, 1, 2].filter((i) => allQuizzes[i] && Array.isArray(allQuizzes[i].questions));
  }

  if (chapters.length === 0) throw new Error('Không tìm thấy chapters/questions trong data.json.');

  total = clampInt(total, 1, 5000);

  // Chuẩn hoá % theo số chương thực có
  const p = percents.slice(0, chapters.length).map((x) => Math.max(0, Number(x) || 0));
  let sumP = p.reduce((a, b) => a + b, 0);
  if (sumP <= 0) {
    // nếu user nhập toàn 0 -> chia đều
    for (let i = 0; i < p.length; i++) p[i] = 100 / p.length;
    sumP = 100;
  }

  // target count theo %
  const target = p.map((pi) => Math.floor((pi / sumP) * total));
  // bù phần dư để đủ total
  let used = target.reduce((a, b) => a + b, 0);
  let remain = total - used;

  // danh sách số câu còn có thể lấy ở từng chương
  const cap = chapters.map((ci, idxLocal) => (allQuizzes[ci].questions || []).length);

  // bù remain vào chương còn "dư" nhiều
  while (remain > 0) {
    let best = -1;
    let bestSlack = -1;
    for (let i = 0; i < target.length; i++) {
      const slack = cap[i] - target[i];
      if (slack > bestSlack) {
        bestSlack = slack;
        best = i;
      }
    }
    if (best === -1 || bestSlack <= 0) break; // không còn đủ câu để bù
    target[best]++;
    remain--;
  }

  // Lấy câu
  let picked = [];
  for (let i = 0; i < chapters.length; i++) {
    const ci = chapters[i];
    const qs = allQuizzes[ci].questions || [];
    const k = Math.min(target[i], qs.length);
    picked = picked.concat(pickRandom(qs, k));
  }

  // Nếu vẫn thiếu (do chương không đủ), top-up từ tất cả chương
  if (picked.length < total) {
    const pool = chapters.flatMap((ci) => allQuizzes[ci].questions || []);
    // loại trùng bằng _id/text (nhẹ nhàng)
    const key = (q) => (q._id ?? '') + '|' + (q.text ?? '');
    const seen = new Set(picked.map(key));
    const rest = pool.filter((q) => !seen.has(key(q)));
    picked = picked.concat(pickRandom(rest, total - picked.length));
  }

  // Shuffle toàn đề để trộn chương
  shuffleInPlace(picked);

  // tạo quiz mới
  const title = `${EXAM_TITLE_PREFIX} (${picked.length} câu)`;
  return {
    title,
    timeLimit: 0, // bạn có thể set theo ý
    questions: picked.map((q, i) => ({
      ...q,
      _id: q._id ?? i,
    })),
  };
}

function upsertExamIntoAllQuizzes(examQuiz) {
  // Nếu đã có "Đề thi ngẫu nhiên" thì replace, không nhân bản
  const idxExist = allQuizzes.findIndex((q) => (q?.title || '').startsWith(EXAM_TITLE_PREFIX));
  if (idxExist >= 0) allQuizzes[idxExist] = examQuiz;
  else allQuizzes.unshift(examQuiz); // đẩy lên đầu cho dễ chọn

  // rebuild search index + dropdown
  buildSearchIndex(allQuizzes);

  $('#quizSelectGroup').style.display = 'grid';
  renderQuizSelect();
}
const STORAGE_KEY = 'shimechamhoc_progress_v1';
let currentTimeLeft = 0;
function shortTitle(s, max = 50) {
  s = String(s || '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function renderQuizSelect() {
  const sel = $('#quizSelect');
  sel.innerHTML = '';

  allQuizzes.forEach((q, i) => {
    const full = q?.title || 'Đề ' + (i + 1);
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = shortTitle(full, 50);
    opt.title = full;
    sel.appendChild(opt);
  });
}
function renderSubjectSelect() {
  const group = $('#subjectSelectGroup');
  const sel = $('#subjectSelect');
  if (!group || !sel) return;

  sel.innerHTML = '';
  subjects.forEach((s, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = shortTitle(s.name || `Môn ${i + 1}`, 50);
    opt.title = s.name || `Môn ${i + 1}`;
    sel.appendChild(opt);
  });

  // chỉ hiện nếu có nhiều môn
  group.style.display = subjects.length > 1 ? 'grid' : 'none';
  sel.value = String(currentSubjectIndex || 0);
}

async function setSubject(index) {
  currentSubjectIndex = Number(index) || 0;
  const s = subjects[currentSubjectIndex] || subjects[0];
  if (!s) return;

  // Nếu môn có file mà chưa có quizzes -> fetch file môn
  if (s.file && (!Array.isArray(s.quizzes) || !s.quizzes.length)) {
    const r = await fetch(s.file);
    const subjectData = await r.json();

    // subject file dạng: { name, quizzes }
    s.name = s.name || subjectData.name || 'Môn học';
    s.quizzes = Array.isArray(subjectData.quizzes) ? subjectData.quizzes : [];
  }

  allQuizzes = Array.isArray(s.quizzes) ? s.quizzes : [];
  buildSearchIndex(allQuizzes);

  if (allQuizzes.length > 1) {
    $('#quizSelectGroup').style.display = 'grid';
    renderQuizSelect();
  } else {
    $('#quizSelectGroup').style.display = 'none';
  }

  setupQuiz(0);

  $('#statusMessage').innerHTML =
    `Đã chọn môn: <b>${sanitizeHTML(s.name || 'Mặc định')}</b>. Chọn bộ đề rồi bấm Bắt đầu!`;
}


// onchange cho dropdown môn
$('#subjectSelect') &&
  ($('#subjectSelect').onchange = (e) => {
    setSubject(e.target.value).catch(() => {});
  });


function handleData(data) {
  // ===== Normalize formats =====
  // 1) JSON cũ: quiz hoặc [quiz]
  // 2) JSON mới: { subjects: [ { name, quizzes:[...] } ] }
  // 3) JSON mới: [ { name, quizzes:[...] } ]  (mảng subjects)
  // 4) wrapper cũ: { quizzes: [...] } / { data: [...] } -> vẫn support

  // unwrap wrappers (bạn đã có ở fileInput, nhưng fetch(data.json) chưa chắc)
  if (data && !Array.isArray(data) && Array.isArray(data.quizzes)) data = data.quizzes;
  if (data && !Array.isArray(data) && Array.isArray(data.data)) data = data.data;

  let normSubjects = [];

  // Case 2: object has subjects
  if (data && !Array.isArray(data) && Array.isArray(data.subjects)) {
    normSubjects = data.subjects.map((s) => ({
      name: s.name || s.title || 'Môn học',
      quizzes: Array.isArray(s.quizzes) ? s.quizzes : [],
    }));
  }
  // Case 3: array subjects
  else if (Array.isArray(data) && data.length && data[0] && Array.isArray(data[0].quizzes)) {
    normSubjects = data.map((s) => ({
      name: s.name || s.title || 'Môn học',
      quizzes: Array.isArray(s.quizzes) ? s.quizzes : [],
    }));
  }
  // Case 1: old quizzes
  else {
    const quizzes = Array.isArray(data) ? data : [data];
    normSubjects = [{ name: 'Mặc định', quizzes }];
  }

  // lọc subject rỗng
  normSubjects = normSubjects.filter((s) => Array.isArray(s.quizzes) && s.quizzes.length);

  subjects = normSubjects.length ? normSubjects : [{ name: 'Mặc định', quizzes: [] }];
  currentSubjectIndex = 0;

  // Render UI
  renderSubjectSelect();
  setSubject(0);
}

function setupQuiz(index) {
  currentQuizIndex = Number(index) || 0;
  quiz = window.structuredClone
    ? structuredClone(allQuizzes[index])
    : JSON.parse(JSON.stringify(allQuizzes[index]));
  quiz.questions.forEach((q, i) => {
    if (q._id == null) q._id = i;
  });
  $('#timeLimit').value = Math.round((quiz.timeLimit || 0) / 60);
  $('#statusMessage').innerHTML =
    `Đã nạp: <b>${sanitizeHTML(quiz.title || '')}</b>. Bấm Bắt đầu ngay!`;
}
$('#quizSelect').onchange = (e) => setupQuiz(e.target.value);

window.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('data/subjects.json');
    const subjectMeta = await res.json();

    if (!Array.isArray(subjectMeta) || !subjectMeta.length) {
      throw new Error('subjects.json không hợp lệ');
    }

    // subjects giữ luôn meta (name + file)
    subjects = subjectMeta.map((s) => ({
      name: s.name,
      file: s.file,
      quizzes: null,
    }));

    currentSubjectIndex = 0;

    // render dropdown (vì subjects.length > 1 thì nó sẽ hiện)
    renderSubjectSelect();

    // load môn đầu tiên
    await setSubject(0);

    // ===== Restore bài làm dở (giữ nguyên logic cũ của bạn) =====
    const saved = loadProgress();
    if (saved && confirm('🔄 Phát hiện bài làm chưa hoàn thành. Tiếp tục không?')) {
      quiz = saved.quiz;
      idx = saved.idx;
      answers = saved.answers;

      if (!Array.isArray(answers) || answers.length !== quiz.questions.length) {
        answers = quiz.questions.map(() => ({ value: null }));
      }

      currentTimeLeft = saved.timeLeft;

      $('#instant').checked = saved.settings.instant;
      $('#autoNext').checked = saved.settings.autoNext;
      $('#shuffle').checked = saved.settings.shuffle;

      $('#screenIntro').style.display = 'none';
      $('#screenQuiz').style.display = 'block';
      mapBuilt = false;
      qCells = [];
      currentCellIndex = -1;

      buildQuestionMapOnce();
      renderQuestion();

      if (currentTimeLeft > 0) {
        if (timerId) clearInterval(timerId);

        timerId = setInterval(() => {
          currentTimeLeft--;
          saveProgressDebounced();

          let m = Math.floor(currentTimeLeft / 60);
          let s = (currentTimeLeft % 60).toString().padStart(2, '0');
          $('#timer').textContent = `${m}:${s}`;

          if (currentTimeLeft <= 0) {
            clearInterval(timerId);
            $('#btnSubmit').click();
          }
        }, 1000);
      } else {
        $('#timer').textContent = '∞';
      }
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch (err) {
    console.error(err);
    $('#statusMessage').textContent = 'Không load được dữ liệu.';
  }
});

$('#fileInput').onchange = (e) => {
  const f = e.target.files?.[0];
  if (!f) return;

  const r = new FileReader();
  r.onload = () => {
    try {
      let text = String(r.result || '');

      // 1) remove BOM (hay làm JSON.parse fail)
      text = text.replace(/^\uFEFF/, '');

      // 2) parse JSON
      let data = JSON.parse(text);

      // 3) support wrapper formats
      // - { quizzes: [...] } hoặc { data: [...] } (phòng trường hợp bạn đóng gói)
      if (data && !Array.isArray(data) && Array.isArray(data.quizzes)) data = data.quizzes;
      if (data && !Array.isArray(data) && Array.isArray(data.data)) data = data.data;

      // 4) nạp
      handleData(data);

      // UI message
      $('#statusMessage').innerHTML =
        `✅ Đã nạp file: <b>${sanitizeHTML(f.name)}</b>. Bấm Bắt đầu ngay!`;
    } catch (err) {
      console.error(err);
      alert('❌ File JSON không hợp lệ hoặc sai format.\nMở Console (F12) để xem lỗi chi tiết.');
      $('#statusMessage').textContent = '❌ Không đọc được JSON. Kiểm tra lại định dạng.';
    } finally {
      // 5) reset để chọn lại cùng 1 file vẫn chạy onchange
      e.target.value = '';
    }
  };

  r.readAsText(f, 'utf-8');
};

function saveProgress() {
  if (!quiz || !answers.length) return;

  const data = {
    quiz,
    idx,
    answers,
    timeLeft: currentTimeLeft,
    settings: {
      instant: $('#instant').checked,
      autoNext: $('#autoNext').checked,
      shuffle: $('#shuffle').checked,
    },
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

const saveProgressDebounced = (() => {
  let t = null;
  return () => {
    clearTimeout(t);
    t = setTimeout(() => {
      try {
        saveProgress();
      } catch (e) {}
    }, 600);
  };
})();
function loadProgress() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}
function buildQuestionMapOnce() {
  const grid = $('#questionGrid');
  if (!grid || mapBuilt || !quiz) return;

  grid.innerHTML = '';
  qCells = new Array(quiz.questions.length);

  quiz.questions.forEach((q, i) => {
    const cell = document.createElement('div');
    cell.className = 'qcell';
    cell.textContent = i + 1;
    cell.dataset.i = i;

    cell.onclick = () => {
      idx = i;
      renderQuestion();
      saveProgressDebounced();
    };

    grid.appendChild(cell);
    qCells[i] = cell;
  });

  mapBuilt = true;

  // cập nhật trạng thái ban đầu 1 lần
  updateAllCells();
  updateCurrentCell();
  applyQuestionFilter();
}

function updateCell(i) {
  const cell = qCells[i];
  if (!cell) return;

  const q = quiz.questions[i];
  const ans = answers[i]?.value ?? null;

  cell.classList.remove('done', 'correct', 'wrong', 'bookmark', 'current');

  if (ans !== null) cell.classList.add('done');
  if (q.bookmarked) cell.classList.add('bookmark');

  const canShowResult = $('#instant').checked || isSubmitted;
  if (canShowResult && ans !== null) {
    if (isAnswerCorrect(q, ans)) cell.classList.add('correct');
    else cell.classList.add('wrong');
  }
}

function updateAllCells() {
  for (let i = 0; i < qCells.length; i++) updateCell(i);
}

function updateCurrentCell() {
  // bỏ current cũ
  if (currentCellIndex >= 0 && qCells[currentCellIndex]) {
    qCells[currentCellIndex].classList.remove('current');
  }
  // set current mới
  currentCellIndex = idx;
  if (qCells[currentCellIndex]) qCells[currentCellIndex].classList.add('current');
}

// Filter chỉ scan 1 lần khi bấm filter, KHÔNG scan mỗi lần click đáp án
function applyQuestionFilter() {
  if (!mapBuilt) return;

  for (let i = 0; i < quiz.questions.length; i++) {
    const q = quiz.questions[i];
    const ans = answers[i]?.value ?? null;

    let show = true;

    if (questionFilter === 'bookmark') {
      show = !!q.bookmarked;
    } else if (questionFilter === 'wrong') {
      const canShowWrong = $('#instant').checked || isSubmitted;
      show = ans !== null && canShowWrong && !isAnswerCorrect(q, ans);
    }
    if (show && searchKeywordN) {
      show = questionMatches(currentQuizIndex, i);
    }
    qCells[i].style.display = show ? '' : 'none';
  }
}

// ---- Answer helpers (single & multi) ----
function asArrayAnswer(ans) {
  if (Array.isArray(ans))
    return ans
      .slice()
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
  if (typeof ans === 'number' && Number.isFinite(ans)) return [ans];
  return [];
}
function asArrayUserAns(v) {
  if (Array.isArray(v))
    return v
      .slice()
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
  if (typeof v === 'number' && Number.isFinite(v)) return [v];
  return [];
}

function isFillQuestion(q) {
  // mặc định: nếu không có choices => coi là câu điền đáp án
  return q?.type === 'input' || q?.type === 'fill' || !Array.isArray(q?.choices);
}

function normFill(s) {
  return String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function toNumberMaybe(s) {
  const t = normFill(s).replace(',', '.'); // 1,5 -> 1.5
  if (!t) return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function isAnswerCorrect(q, userVal) {
  // ✅ CÂU ĐIỀN ĐÁP ÁN
  if (isFillQuestion(q)) {
    const correct = (q.answerText ?? q.answer ?? '').toString();
    const u = normFill(userVal);
    const c = normFill(correct);

    if (!u || !c) return false;

    // nếu cả 2 đều là số hợp lệ -> so sánh số
    const un = toNumberMaybe(u);
    const cn = toNumberMaybe(c);
    if (Number.isFinite(un) && Number.isFinite(cn)) return Math.abs(un - cn) < 1e-9;

    // còn lại so sánh text (đã chuẩn hoá)
    return u === c;
  }

  // ✅ SINGLE / MULTI CHOICE (như cũ)
  const a = asArrayAnswer(q.answer);
  const u = asArrayUserAns(userVal);
  if (!a.length) return false;
  if (a.length !== u.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== u[i]) return false;
  return true;
}

function isChoiceCorrect(q, choiceIndex) {
  return asArrayAnswer(q.answer).includes(choiceIndex);
}
// ===== UPDATE UI CHO CHOICES (KHÔNG RERENDER) =====
function applyChoiceUI() {
  const q = quiz.questions[idx];
  if (isFillQuestion(q)) return;
  const selected = answers[idx]?.value ?? null;

  const selectedArr = asArrayUserAns(selected);
  const nodes = Array.from($('#qChoices').children);

  nodes.forEach((node, i) => {
    node.classList.remove('active', 'correct', 'wrong');

    // update input checked (radio/checkbox)
    const input = node.querySelector('input');
    if (input) input.checked = selectedArr.includes(i);

    // active styling
    if (selectedArr.includes(i)) node.classList.add('active');

    // instant grading
    const canShowResult = $('#instant').checked || isSubmitted;
    if (selectedArr.length && canShowResult) {
      if (isChoiceCorrect(q, i)) {
        node.classList.add('correct');
      } else if (selectedArr.includes(i)) {
        node.classList.add('wrong');
      }
    }
  });
}
function selectChoice(choiceIndex) {
  const q = quiz.questions[idx];
  if (!answers[idx]) answers[idx] = { value: null };

  const isMulti = Array.isArray(q.answer);

  if (!isMulti) {
    answers[idx].value = choiceIndex;
  } else {
    const cur = asArrayUserAns(answers[idx].value);
    const pos = cur.indexOf(choiceIndex);
    if (pos >= 0) cur.splice(pos, 1);
    else cur.push(choiceIndex);
    cur.sort((a, b) => a - b);
    answers[idx].value = cur.length ? cur : null;
  }

  applyChoiceUI();

  // update map cell + save
  if (mapBuilt) {
    updateCell(idx);
    applyQuestionFilter();
  }

  saveProgressDebounced();

  // Prefetch AI silently (especially useful in instant-mode / wrong answers)
  try {
    const userVal = answers[idx].value;
    const instant = $('#instant').checked;
    if (instant) {
      // prioritize prefetch when user seems wrong
      if (!isAnswerCorrect(q, userVal)) prefetchAIExplain(q, userVal);
    } else {
      // light prefetch anyway
      prefetchAIExplain(q, userVal);
    }
  } catch {}

  // instant explanation text (local)
  const canShowResult = $('#instant').checked || isSubmitted;
  if (canShowResult && answers[idx].value !== null) {
    if (q.explanation) {
      $('#explain').textContent = 'Giải thích: ' + q.explanation;
      renderMathDebounced($('#explain'), 50);
    }
  }

  // auto next (only for single-choice, otherwise user needs multi picks)
  if (!isMulti && $('#autoNext').checked && idx < quiz.questions.length - 1) {
    clearTimeout(autoNextTimer);
    const extra = 500;
    const delay = ($('#instant').checked ? 800 : 250) + extra;
    autoNextTimer = setTimeout(() => {
      idx++;
      renderQuestion();
      saveProgressDebounced();
    }, delay);
  }
  // ===== SHEEP POPUP: sai 3 câu liên tiếp =====
  try {
    const instant = $('#instant').checked;
    const userVal = answers[idx].value;

    if (instant && userVal !== null) {
      const isWrong = !isAnswerCorrect(q, userVal);
      const key = `${idx}|${Array.isArray(userVal) ? userVal.join(',') : userVal}`;

      if (isWrong) {
        // chỉ tính 1 lần cho mỗi lựa chọn ở mỗi câu
        if (key !== lastWrongKey) {
          wrongStreak++;
          lastWrongKey = key;
        }

        if (wrongStreak >= 3 && !sheepOpen) {
  sheepOpen = true;
  const popup = $('#sheepPopup');
  popup.style.display = 'flex';

  const img = popup.querySelector('img');
  if (img) {
    img.classList.remove('shake');
    void img.offsetWidth; // force reflow
    img.classList.add('shake');
  }
}

      } else {
        // trả lời đúng → reset
        wrongStreak = 0;
        lastWrongKey = '';
      }
    }
  } catch {}
}
function renderQuestion() {
  const quizScreen = $('#screenQuiz');
  quizScreen.classList.add('is-switching');

  try {
    const q = quiz.questions[idx];
    if (!answers[idx]) answers[idx] = { value: null };
    if (q.bookmarked === undefined) q.bookmarked = false;

    $('#qIndex').textContent = `Câu ${idx + 1}/${quiz.questions.length}`;

    const qTextEl = $('#qText');
    qTextEl.innerHTML = sanitizeHTML(q.text);

    const box = $('#qChoices');
    box.innerHTML = '';
    $('#explain').textContent = '';

    // ✅ NEW: nếu là câu điền đáp án (type=input hoặc không có choices)
    if (isFillQuestion(q)) {
      const cur = answers[idx]?.value ?? '';

      box.innerHTML = `
        <div class="choice" style="cursor:default">
          <div style="width:100%">
            <div class="muted" style="margin-bottom:8px">Điền đáp án:</div>
            <input id="fillInput" type="text" placeholder="Nhập đáp án..."
              style="width:100%;padding:12px;border-radius:12px;
                     background:rgba(255,255,255,0.03);
                     color:var(--text);
                     border:1px solid var(--border);" />
          </div>
        </div>
      `;

      const inp = $('#fillInput');
      inp.value = cur;

      inp.oninput = () => {
        answers[idx].value = inp.value.trim() ? inp.value : null;
        saveProgressDebounced();
        if (mapBuilt) {
          updateCell(idx);
          applyQuestionFilter();
        }
      };

      // hiển thị đúng/sai (instant hoặc đã nộp)
      const canShowResult = $('#instant').checked || isSubmitted;
      if (canShowResult && String(inp.value || '').trim() !== '') {
        const ok = isAnswerCorrect(q, inp.value);
        box.firstElementChild.classList.toggle('correct', ok);
        box.firstElementChild.classList.toggle('wrong', !ok);
      }

      typesetAndThen([qTextEl, box], () => {
        quizScreen.classList.remove('is-switching');
      });

      $('#btnPrev').disabled = idx === 0;
      $('#btnNext').style.visibility = idx === quiz.questions.length - 1 ? 'hidden' : 'visible';

      buildQuestionMapOnce();
      updateCell(idx);
      updateCurrentCell();
      applyQuestionFilter();

      const bm = $('#bookmarkBtn');
      bm.classList.toggle('active', q.bookmarked);
      bm.textContent = q.bookmarked ? '⭐' : '☆';
      bm.onclick = () => {
        q.bookmarked = !q.bookmarked;
        bm.classList.toggle('active', q.bookmarked);
        bm.textContent = q.bookmarked ? '⭐' : '☆';
        saveProgressDebounced();
        if (mapBuilt) {
          updateCell(idx);
          applyQuestionFilter();
        }
      };

      return;
    }

    // ✅ Câu trắc nghiệm (giữ logic cũ)
    const isMulti = Array.isArray(q.answer);
    const inputType = isMulti ? 'checkbox' : 'radio';
    const inputName = 'opt';

    q.choices.forEach((c, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'choice';
      wrap.dataset.choice = String(i);
      wrap.innerHTML = `
        <input type="${inputType}" name="${inputName}" style="margin-right:10px">
        <label style="cursor:pointer">${sanitizeHTML(c)}</label>
      `;
      box.appendChild(wrap);
    });

    applyChoiceUI();

    typesetAndThen([qTextEl, box], () => {
      quizScreen.classList.remove('is-switching');
    });

    $('#btnPrev').disabled = idx === 0;
    $('#btnNext').style.visibility = idx === quiz.questions.length - 1 ? 'hidden' : 'visible';

    buildQuestionMapOnce();
    updateCell(idx);
    updateCurrentCell();
    applyQuestionFilter();

    const bm = $('#bookmarkBtn');
    bm.classList.toggle('active', q.bookmarked);
    bm.textContent = q.bookmarked ? '⭐' : '☆';

    bm.onclick = () => {
      q.bookmarked = !q.bookmarked;
      bm.classList.toggle('active', q.bookmarked);
      bm.textContent = q.bookmarked ? '⭐' : '☆';
      saveProgressDebounced();
      if (mapBuilt) {
        updateCell(idx);
        applyQuestionFilter();
      }
    };
  } catch (e) {
    console.error(e);
    // ✅ tránh bị kẹt opacity 0
    $('#screenQuiz').classList.remove('is-switching');
    $('#statusMessage').textContent = '❌ Lỗi render câu hỏi: ' + (e?.message || e);
  }
}

$('#btnNext').onclick = () => {
  if (idx < quiz.questions.length - 1) {
    idx++;
    renderQuestion();
    saveProgressDebounced();
  }
};

$('#btnPrev').onclick = () => {
  if (idx > 0) {
    idx--;
    renderQuestion();
    saveProgressDebounced();
  }
};

$('#btnStart').onclick = () => {
  if (!quiz) return;
  if ($('#shuffle').checked) shuffleInPlace(quiz.questions);
  answers = quiz.questions.map(() => ({ value: null }));
  idx = 0;

  mapBuilt = false;
  qCells = [];
  currentCellIndex = -1;

  $('#screenIntro').style.display = 'none';
  $('#screenQuiz').style.display = 'block';

  buildQuestionMapOnce();
  renderQuestion();
  startTimer();
};

function launchFireworks() {
  const canvas = document.getElementById('fireworks');
  const ctx = canvas.getContext('2d');

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  let particles = [];

  function boom(x) {
    for (let i = 0; i < 80; i++) {
      particles.push({
        x,
        y: canvas.height * 0.5,
        vx: Math.cos(Math.random() * Math.PI * 2) * (3 + Math.random() * 4),
        vy: Math.sin(Math.random() * Math.PI * 2) * (3 + Math.random() * 4),
        life: 60,
        color: `hsl(${Math.random() * 360},100%,60%)`,
      });
    }
  }

  boom(canvas.width * 0.2);
  boom(canvas.width * 0.8);

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p, i) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05;
      p.life--;

      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();

      if (p.life <= 0) particles.splice(i, 1);
    });

    if (particles.length) requestAnimationFrame(animate);
  }

  animate();

  const text = document.getElementById('congratsText');
  text.classList.add('show');
  setTimeout(() => text.classList.remove('show'), 4000);
}
$('#btnSubmit').onclick = () => {
  if (!confirm('Bạn muốn nộp bài?')) return;
  isSubmitted = true;
  if (mapBuilt) {
    updateAllCells();
    applyQuestionFilter();
  }
  localStorage.removeItem(STORAGE_KEY);
  clearInterval(timerId);
  let totalCorrect = 0;
  quiz.questions.forEach((q, i) => {
    const userVal = answers[i]?.value ?? null;
    if (userVal !== null && isAnswerCorrect(q, userVal)) totalCorrect++;
  });
  const total = quiz.questions.length;
  const percent = Math.round((totalCorrect / total) * 100);
    // ===== SAVE HISTORY (local) =====
  try {
    const wrongs = [];
    quiz.questions.forEach((q, i) => {
      const userVal = answers[i]?.value ?? null;
      if (userVal === null) return;
      if (!isAnswerCorrect(q, userVal)) {
        const preview = String(q.text || '').replace(/\s+/g, ' ').trim().slice(0, 90);

        const your =
          Array.isArray(userVal)
            ? userVal.map((k) => q.choices?.[k] ?? `(${k})`).join(' | ')
            : q.choices?.[userVal] ?? String(userVal);

        const corrArr = Array.isArray(q.answer) ? q.answer : [q.answer];
        const correct = corrArr.map((k) => q.choices?.[k] ?? `(${k})`).join(' | ');

        wrongs.push({ i, preview, your, correct });
      }
    });

    window.HistoryStore?.recordAttempt({
      ts: Date.now(),
      quizTitle: quiz.title || 'Bộ đề',
      total,
      correct: totalCorrect,
      percent,
      wrongs,
    });
  } catch {}

  $('#scoreLine').textContent = `Kết quả: ${totalCorrect}/${total} câu đúng (${percent}%)`;
  $('#scoreBar').style.width = percent + '%';
  $('#screenQuiz').style.display = 'none';
  $('#screenResult').style.display = 'block';
  requestAnimationFrame(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  });
  $('#resultOverlay').classList.add('show');
  $('#congratsText').classList.add('show');
  setTimeout(() => {
    $('#resultOverlay').classList.remove('show');
    $('#congratsText').classList.remove('show');
  }, 2500);

  generateReview();
  launchFireworks();
};

function previewText(s, max = 70) {
  const t = String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '';
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function generateReview() {
  const area = $('#reviewArea');
  area.innerHTML = `
    <div class="muted" style="margin-top:6px">...</div>
    <div class="muted" style="margin-top:6px">Bấm vào từng câu để xem chi tiết đúng/sai.</div>
    <div id="reviewList" style="display:grid; gap:12px; margin-top:14px"></div>
  `;

  const list = $('#reviewList');

  const fmt = (q, val) => {
    if (isFillQuestion(q)) {
      const s = String(val ?? '').trim();
      return s ? sanitizeHTML(s) : 'Chưa trả lời';
    }
    const arr = asArrayUserAns(val);
    if (!arr.length) return 'Chưa trả lời';
    return arr.map((i) => sanitizeHTML(q.choices[i] ?? `(${i})`)).join(' | ');
  };

  const fmtCorrect = (q) => {
    if (isFillQuestion(q)) {
      const s = String(q.answerText ?? q.answer ?? '').trim();
      return s ? sanitizeHTML(s) : '(thiếu đáp án)';
    }
    const arr = asArrayAnswer(q.answer);
    return arr.map((i) => sanitizeHTML(q.choices[i] ?? `(${i})`)).join(' | ');
  };

  // helper: trạng thái
  const getStatus = (q, userAns) => {
    if (userAns == null || (Array.isArray(userAns) && userAns.length === 0)) return 'blank';
    return isAnswerCorrect(q, userAns) ? 'correct' : 'wrong';
  };

  quiz.questions.forEach((q, i) => {
    const userAns = answers[i]?.value ?? null;
    const status = getStatus(q, userAns);

    const badge = status === 'correct' ? '✅ Đúng' : status === 'wrong' ? '❌ Sai' : '⚪ Chưa làm';

    const borderColor =
      status === 'correct' ? 'var(--ok)' : status === 'wrong' ? 'var(--bad)' : 'var(--border)';

    // item container
    const item = document.createElement('div');
    item.className = 'card pad reviewItem';
    item.style.borderLeft = `5px solid ${borderColor}`;
    item.style.cursor = 'pointer';

    // header (luôn hiện)
    item.innerHTML = `
  <div class="reviewHead" style="display:flex; align-items:center; justify-content:space-between; gap:12px">
    <div style="min-width:0">
      <div style="font-weight:800">
        Câu ${i + 1} <span class="muted" style="font-weight:600">(${badge})</span>
      </div>

      <div class="muted"
           style="font-size:13px; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
        ${sanitizeHTML(previewText(q.text, 70))}
      </div>
    </div>

    <div class="muted reviewChevron" style="font-size:18px; flex:0 0 auto">▸</div>
  </div>

  <div class="reviewDetail" style="display:none; margin-top:12px">
    <div style="padding-top:10px; border-top:1px solid var(--border)">
      <div style="font-weight:800; margin-bottom:6px">Nội dung:</div>
      <div style="margin-bottom:10px">${sanitizeHTML(q.text)}</div>

      <div style="color:${status === 'correct' ? 'var(--ok)' : status === 'wrong' ? 'var(--bad)' : 'var(--text)'}">
        <div><b>Bạn chọn:</b> ${fmt(q, userAns)}</div>
        <div><b>Đáp án đúng:</b> ${fmtCorrect(q)}</div>
      </div>

      ${
        q.explanation
          ? `
        <div class="muted" style="margin-top:8px; font-size:13px">
          ${sanitizeHTML(q.explanation)}
        </div>`
          : ``
      }
    </div>
  </div>
`;

    // click-to-toggle
    item.addEventListener('click', () => {
      const detail = item.querySelector('.reviewDetail');
      const chev = item.querySelector('.reviewChevron');
      const isOpen = detail.style.display !== 'none';
      detail.style.display = isOpen ? 'none' : 'block';
      chev.textContent = isOpen ? '▸' : '▾';

      // typeset MathJax chỉ khi mở (đúng yêu cầu tối ưu)
      if (!isOpen) renderMathDebounced(detail, 80);
    });

    list.appendChild(item);
  });

  // Không typeset toàn bộ nữa. Chỉ typeset khi mở từng câu.
}
function startTimer() {
  if (timerId) clearInterval(timerId);

  currentTimeLeft = Number($('#timeLimit').value) * 60;
  if (currentTimeLeft <= 0) {
    $('#timer').textContent = '∞';
    return;
  }
  timerId = setInterval(() => {
    currentTimeLeft--;
    saveProgressDebounced();
    let m = Math.floor(currentTimeLeft / 60);
    let s = (currentTimeLeft % 60).toString().padStart(2, '0');
    $('#timer').textContent = `${m}:${s}`;
    if (currentTimeLeft <= 0) {
      clearInterval(timerId);
      $('#btnSubmit').click();
    }
  }, 1000);
}
// ===== THEME TOGGLE =====
const themeBtn = document.getElementById('toggleTheme');

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  setTheme(current === 'dark' ? 'light' : 'dark');
}
// Load theme khi mở trang
const savedTheme = localStorage.getItem('theme') || 'dark';
setTheme(savedTheme);
// Click nút
themeBtn.onclick = toggleTheme;
$('#filterAll').onclick = () => {
  questionFilter = 'all';
  applyQuestionFilter();
};
$('#filterBookmark').onclick = () => {
  questionFilter = 'bookmark';
  applyQuestionFilter();
};
$('#filterWrong').onclick = () => {
  questionFilter = 'wrong';
  applyQuestionFilter();
};
$('#searchBox').oninput = (e) => {
  searchKeywordN = strip(e.target.value);
  applyQuestionFilter();
};
// ===== Button: Tạo đề thi =====
$('#btnMakeExam').onclick = () => {
  try {
    const total = clampInt($('#examCount').value, 10, 2000);
    const p1 = clampInt($('#p1').value, 0, 100);
    const p2 = clampInt($('#p2').value, 0, 100);
    const p3 = clampInt($('#p3').value, 0, 100);

    const examQuiz = createExamQuiz({
      total,
      percents: [p1, p2, p3],
    });

    upsertExamIntoAllQuizzes(examQuiz);
    // chuyển sang quiz đề thi vừa tạo
    $('#quizSelect').value = 0;
    setupQuiz(0);

    $('#examInfo').textContent = `✅ Đã tạo: ${examQuiz.title}. Bấm "Bắt đầu" để làm.`;
  } catch (e) {
    $('#examInfo').textContent = '❌ ' + (e?.message || e);
  }
};
// ===== GUIDED TOUR (FIXED) =====
const TOUR_KEY = 'shime_tour_done';

let tourStep = 0;
let tourSteps = [];
let tourActive = false;

let _tourTargetEl = null;
let _tourStepCleanup = null;
let _tourRAF = 0;
let _tourEventsBound = false;

// --- Steps: Desktop vs Mobile ---
const tourStepsDesktop = [
  { el: '#btnLoadJson', text: 'Bấm vào đây để nạp file JSON đề thi.' },
  { el: '#btnLoadTextbook', text: 'Nhập giáo trình để tự tạo đề.' },
  { el: '#toggleTheme', text: 'Đổi giao diện sáng / tối tại đây.' },
  { el: '#subjectSelect', text: 'Chọn môn học trước (VD: Toán / Tiếng Anh).' },
  { el: '#quizSelect', text: 'Chọn bộ đề muốn làm (nếu có nhiều bộ).' },
  { el: '#btnStart', text: 'Bắt đầu làm bài tại đây.' },

  // Các bước chỉ có khi đang ở màn làm bài
  { el: '#bookmarkBtn', text: 'Đánh dấu câu hỏi cần xem lại.' },
  { el: '#btnAIExplain', text: 'Nhờ AI giải thích khi chưa hiểu.' },
  { el: '#questionMap', text: 'Bản đồ câu hỏi: xem nhanh trạng thái làm bài.' },
  { el: '#questionGrid', text: 'Bấm ô số để nhảy nhanh tới câu đó.' },
  { el: '#filterWrong', text: 'Lọc để xem các câu sai.' },
  { el: '#filterBookmark', text: 'Lọc các câu đã bookmark.' },
  { el: '#searchBox', text: 'Tìm nhanh câu hỏi theo từ khóa.' },
];

const tourStepsMobile = [
  // ✅ yêu cầu của bạn: bước 1 là bấm menu
  { el: '#btnTools', text: 'Trên điện thoại: bấm ☰ Công cụ để mở menu.' },
  { el: '#mLoadJson', text: 'Trong menu: nạp file JSON đề thi tại đây.' },
  { el: '#mLoadTextbook', text: 'Trong menu: nạp giáo trình để tự tạo đề.' },
  { el: '#mTheme', text: 'Trong menu: đổi giao diện sáng / tối.' },

  // Sau menu giống desktop
  { el: '#subjectSelect', text: 'Chọn môn học trước (VD: Toán / Tiếng Anh).' },
  { el: '#quizSelect', text: 'Chọn bộ đề muốn làm (nếu có nhiều bộ).' },
  { el: '#btnStart', text: 'Bắt đầu làm bài tại đây.' },

  { el: '#bookmarkBtn', text: 'Đánh dấu câu hỏi cần xem lại.' },
  { el: '#btnAIExplain', text: 'Nhờ AI giải thích khi chưa hiểu.' },
  { el: '#questionMap', text: 'Bản đồ câu hỏi: xem nhanh trạng thái làm bài.' },
  { el: '#questionGrid', text: 'Bấm ô số để nhảy nhanh tới câu đó.' },
  { el: '#filterWrong', text: 'Lọc để xem các câu sai.' },
  { el: '#filterBookmark', text: 'Lọc các câu đã bookmark.' },
  { el: '#searchBox', text: 'Tìm nhanh câu hỏi theo từ khóa.' },
];

function isMobileTour() {
  // khớp breakpoint bạn đang dùng để hiện menu mobile
  return window.matchMedia('(max-width: 520px)').matches;
}
function getTourSteps() {
  return isMobileTour() ? tourStepsMobile : tourStepsDesktop;
}

// --- Brightness controls (giữ tính năng cũ) ---
function setTourVars({ overlay, bright, glow } = {}) {
  const root = document.documentElement;
  if (overlay != null) root.style.setProperty('--tour-overlay', String(overlay));
  if (bright != null) root.style.setProperty('--tour-bright', String(bright));
  if (glow != null) root.style.setProperty('--tour-glow', String(glow));
}
document.getElementById('tourDim')?.addEventListener('click', () => {
  setTourVars({ overlay: 0.55, bright: 1.35, glow: 0.65 });
});
document.getElementById('tourBright')?.addEventListener('click', () => {
  setTourVars({ overlay: 0.35, bright: 1.55, glow: 0.85 });
});

// --- Helpers ---
function isVisible(el) {
  if (!el) return false;
  const s = getComputedStyle(el);
  if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function ensureStepContext(stepElSelector) {
  const needQuizScreen = [
    '#bookmarkBtn',
    '#btnAIExplain',
    '#questionMap',
    '#questionGrid',
    '#qText',
    '#qChoices',
    '#filterAll',
    '#filterBookmark',
    '#filterWrong',
    '#searchBox',
  ].includes(stepElSelector);

  if (needQuizScreen) {
    const screenQuiz = document.getElementById('screenQuiz');
    if (screenQuiz && getComputedStyle(screenQuiz).display === 'none') {
      const startIndex = tourSteps.findIndex((s) => s.el === '#btnStart');
      if (startIndex >= 0) {
        tourStep = startIndex;
        return false;
      }
    }
  }
  return true;
}

// --- Reposition spotlight/tooltip ---
function positionTourForElement(el) {
  if (!tourActive || !el) return;

  const spot = document.getElementById('tourSpotlight');
  const tip = document.getElementById('tourTooltip');
  if (!spot || !tip) return;

  const r = el.getBoundingClientRect();
  const pad = 8;

  // Spotlight
  const left = Math.max(pad, r.left - pad);
  const top = Math.max(pad, r.top - pad);
  const w = Math.min(window.innerWidth - pad * 2, r.width + pad * 2);
  const h = Math.min(window.innerHeight - pad * 2, r.height + pad * 2);

  spot.style.left = Math.round(left) + 'px';
  spot.style.top = Math.round(top) + 'px';
  spot.style.width = Math.round(w) + 'px';
  spot.style.height = Math.round(h) + 'px';

  // Tooltip: không tràn màn hình
  const pad2 = 12;
  const isMob = window.innerWidth < 640;

  tip.style.maxWidth = `min(420px, ${window.innerWidth - pad2 * 2}px)`;

  let tx = isMob ? r.left : r.right + 12;
  let ty = isMob ? r.bottom + 12 : r.top;

  tip.style.left = Math.round(tx) + 'px';
  tip.style.top = Math.round(ty) + 'px';

  const tr = tip.getBoundingClientRect();

  if (!isMob && tx + tr.width > window.innerWidth - pad2) {
    tx = r.left - tr.width - 12;
  }

  tx = Math.min(window.innerWidth - pad2 - tr.width, Math.max(pad2, tx));

  if (ty + tr.height > window.innerHeight - pad2) {
    ty = r.top - tr.height - 12;
  }
  ty = Math.min(window.innerHeight - pad2 - tr.height, Math.max(pad2, ty));

  tip.style.left = Math.round(tx) + 'px';
  tip.style.top = Math.round(ty) + 'px';
}

function scheduleTourReposition() {
  if (!tourActive || !_tourTargetEl) return;
  cancelAnimationFrame(_tourRAF);
  _tourRAF = requestAnimationFrame(() => positionTourForElement(_tourTargetEl));
}

// --- Bind/unbind events to keep positioning correct ---
function bindTourEvents() {
  if (_tourEventsBound) return;
  _tourEventsBound = true;

  document.addEventListener('keydown', onTourKeyDown, true);
  window.addEventListener('resize', scheduleTourReposition);
  window.addEventListener('scroll', scheduleTourReposition, true);

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleTourReposition);
    window.visualViewport.addEventListener('scroll', scheduleTourReposition);
  }
}
function unbindTourEvents() {
  if (!_tourEventsBound) return;
  _tourEventsBound = false;

  document.removeEventListener('keydown', onTourKeyDown, true);
  window.removeEventListener('resize', scheduleTourReposition);
  window.removeEventListener('scroll', scheduleTourReposition, true);

  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', scheduleTourReposition);
    window.visualViewport.removeEventListener('scroll', scheduleTourReposition);
  }
}

// --- Cleanup highlight + hook ---
function clearTourHighlight() {
  cancelAnimationFrame(_tourRAF);
  _tourRAF = 0;

  document.querySelectorAll('.tour-target').forEach((x) => x.classList.remove('tour-target'));
  _tourTargetEl = null;

  // đóng menu mobile cho sạch UI
  document.getElementById('toolMenu')?.classList.remove('show');

  // cleanup hook step
  if (typeof _tourStepCleanup === 'function') _tourStepCleanup();
  _tourStepCleanup = null;
}
function setStepHook(cleanupFn) {
  if (typeof _tourStepCleanup === 'function') _tourStepCleanup();
  _tourStepCleanup = typeof cleanupFn === 'function' ? cleanupFn : null;
}

// --- Core tour flow ---
function startTour() {
  clearTourHighlight();

  tourSteps = getTourSteps().filter((s) => document.querySelector(s.el));

  tourStep = 0;
  tourActive = true;

  setTourVars({ overlay: 0.45, bright: 1.35, glow: 0.65 });

  document.getElementById('tourOverlay').style.display = 'block';
  bindTourEvents();
  showTourStep(0);
}

function endTour() {
  tourActive = false;
  document.getElementById('tourOverlay').style.display = 'none';

  // ✅ FIX #1: kết thúc tour phải remove glow / class highlight
  clearTourHighlight();
  unbindTourEvents();

  localStorage.setItem(TOUR_KEY, '1');
}

function showTourStep(i) {
  const step = tourSteps[i];
  if (!step) return endTour();

  // mở toolMenu nếu step nằm trong menu
  const menu = document.getElementById('toolMenu');
  if (['#mTheme', '#mLoadJson', '#mLoadTextbook', '#mHelp'].includes(step.el)) {
    menu?.classList.add('show');
  } else {
    menu?.classList.remove('show');
  }

  if (!ensureStepContext(step.el)) {
    showTourStep(tourStep);
    return;
  }

  const el = document.querySelector(step.el);
  if (!isVisible(el)) return nextTour();

  // set highlight
  document.querySelectorAll('.tour-target').forEach((x) => x.classList.remove('tour-target'));
  el.classList.add('tour-target');
  _tourTargetEl = el;

  // set text
  document.getElementById('tourText').textContent = step.text;

  // scroll tới element (smooth), spotlight sẽ bám theo nhờ scroll listener
  el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  scheduleTourReposition();

  // focus Next để Enter tiện
  setTimeout(() => document.getElementById('tourNext')?.focus(), 0);

  // reset hook cũ
  setStepHook(null);

  // ✅ FIX #2: Mobile step #btnTools — user bấm mở menu thì tự sang bước sau
  if (step.el === '#btnTools') {
    const btnTools = document.getElementById('btnTools');
    if (btnTools) {
      const handler = () => {
        const isOpen = document.getElementById('toolMenu')?.classList.contains('show');
        if (isOpen && tourActive && tourSteps[tourStep]?.el === '#btnTools') {
          setTimeout(() => nextTour(), 0);
        }
      };
      btnTools.addEventListener('click', handler);
      setStepHook(() => btnTools.removeEventListener('click', handler));
    }
  }
}

function nextTour() {
  tourStep++;
  if (tourStep >= tourSteps.length) return endTour();
  showTourStep(tourStep);
}
function prevTour() {
  tourStep = Math.max(0, tourStep - 1);
  showTourStep(tourStep);
}

// ✅ FIX #4: Enter = Next
function onTourKeyDown(e) {
  if (!tourActive) return;
  const overlay = document.getElementById('tourOverlay');
  if (!overlay || overlay.style.display === 'none') return;

  // tránh cướp phím khi đang gõ textarea/contenteditable
  const ae = document.activeElement;
  const tag = ae && ae.tagName ? ae.tagName.toLowerCase() : '';
  const typing = tag === 'textarea' || (ae && ae.isContentEditable);

  if (e.key === 'Escape') {
    e.preventDefault();
    endTour();
    return;
  }
  if (typing) return;

  if (e.key === 'Enter') {
    e.preventDefault();
    nextTour();
    return;
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    nextTour();
    return;
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    prevTour();
    return;
  }
}

// Buttons
document.getElementById('tourNext').onclick = nextTour;
document.getElementById('tourPrev').onclick = prevTour;
document.getElementById('tourSkip').onclick = endTour;

// Start tour buttons
document.getElementById('btnHelp').onclick = startTour;
document.getElementById('mHelp').onclick = startTour;

// Welcome popup
window.addEventListener('DOMContentLoaded', () => {
  if (!localStorage.getItem(TOUR_KEY)) {
    document.getElementById('tourWelcome').style.display = 'flex';
  }
  document.getElementById('tourYes').onclick = () => {
    document.getElementById('tourWelcome').style.display = 'none';
    startTour();
  };
  document.getElementById('tourNo').onclick = () => {
    document.getElementById('tourWelcome').style.display = 'none';
    localStorage.setItem(TOUR_KEY, '1');
  };
});
