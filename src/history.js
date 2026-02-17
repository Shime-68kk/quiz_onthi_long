(() => {
  const HISTORY_KEY = 'shimechamhoc_history_v1';
  const MAX_ITEMS = 80;

  const qs = (s) => document.querySelector(s);

  function loadHistory() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function saveHistory(list) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  }

  function pushAttempt(attempt) {
    const list = loadHistory();
    list.unshift(attempt);
    if (list.length > MAX_ITEMS) list.length = MAX_ITEMS;
    saveHistory(list);
  }

  function fmtTime(ts) {
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return String(ts);
    }
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  function renderHistory() {
    const box = qs('#historyList');
    if (!box) return;

    const list = loadHistory();
    if (!list.length) {
      box.innerHTML = `<div class="muted">Chưa có lịch sử.</div>`;
      return;
    }

    box.innerHTML = '';
    list.forEach((it, idx) => {
      const item = document.createElement('div');
      item.className = 'card pad historyItem';

      const wrongCount = it.wrongs?.length || 0;
      item.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
          <div style="min-width:0">
            <div style="font-weight:800">
              ${escapeHtml(it.quizTitle || 'Bài làm')}
              <span class="muted" style="font-weight:600">(${fmtTime(it.ts)})</span>
            </div>
            <div class="muted" style="margin-top:4px">
              Điểm: <b>${it.correct}/${it.total}</b> (${it.percent}%)
              • Sai: <b>${wrongCount}</b>
            </div>
          </div>

          <div class="muted" style="font-size:18px;flex:0 0 auto">▸</div>
        </div>

        <div class="historyDetail">
          ${
            wrongCount
              ? `<div style="font-weight:800;margin-bottom:8px">Câu sai</div>
                 <div style="display:grid;gap:8px">
                   ${it.wrongs
                     .map(
                       (w) => `
                       <div class="muted" style="padding:10px;border:1px solid var(--border);border-radius:12px">
                         <div><b>Câu ${w.i + 1}:</b> ${escapeHtml(w.preview || '')}</div>
                         <div><b>Bạn chọn:</b> ${escapeHtml(w.your || '—')}</div>
                         <div><b>Đúng:</b> ${escapeHtml(w.correct || '—')}</div>
                       </div>
                     `
                     )
                     .join('')}
                 </div>`
              : `<div class="muted">Không có câu sai 🎉</div>`
          }
        </div>
      `;

      item.addEventListener('click', () => {
        const detail = item.querySelector('.historyDetail');
        const chev = item.querySelector('div[style*="font-size:18px"]');
        const open = detail.style.display !== 'none';
        detail.style.display = open ? 'none' : 'block';
        if (chev) chev.textContent = open ? '▸' : '▾';
      });

      box.appendChild(item);
    });
  }

  function openHistory() {
    const modal = qs('#historyModal');
    if (!modal) return;
    renderHistory();
    modal.style.display = 'flex';
  }

  function closeHistory() {
    const modal = qs('#historyModal');
    if (!modal) return;
    modal.style.display = 'none';
  }

  // expose API để script.js gọi lúc submit
  window.HistoryStore = {
    recordAttempt(attempt) {
      pushAttempt(attempt);
    },
    openHistory,
  };

  // Bind UI
  window.addEventListener('DOMContentLoaded', () => {
    qs('#btnHistory')?.addEventListener('click', openHistory);
    qs('#mHistory')?.addEventListener('click', openHistory);
    qs('#btnCloseHistory')?.addEventListener('click', closeHistory);

    qs('#btnClearHistory')?.addEventListener('click', () => {
      if (!confirm('Xóa toàn bộ lịch sử?')) return;
      saveHistory([]);
      renderHistory();
    });

    qs('#btnExportHistory')?.addEventListener('click', () => {
      const data = JSON.stringify(loadHistory(), null, 2);
      const blob = new Blob([data], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'shimechamhoc-history.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 500);
    });

    // click nền để đóng
    qs('#historyModal')?.addEventListener('click', (e) => {
      if (e.target?.id === 'historyModal') closeHistory();
    });
  });
})();
