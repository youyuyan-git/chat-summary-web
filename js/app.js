let DATA = null;

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ---------- scoring (transparent, formula-based, computed from raw facts) ---------- */

function tier(value, breaks) {
  for (let i = 0; i < breaks.length; i++) {
    if (value <= breaks[i]) return i + 1;
  }
  return breaks.length + 1;
}

function computeScores(c) {
  const experience = tier(c.yearsInPolitics.years, [3, 7, 11, 15]); // 1-5
  const wins = c.electionHistory.filter(e => e.result === '當選' || e.result === '連任').length;
  const continuity = tier(wins, [1, 2, 3, 4]); // 1-5

  const allPledges = c.currentPlatform.flatMap(g => g.items);
  const concreteCount = allPledges.filter(p => /[0-9]/.test(p)).length;
  const platformConcreteness = allPledges.length
    ? Math.round((concreteCount / allPledges.length) * 100)
    : null;

  let trackRecord = null;
  if (c.pastRecord.applicable) {
    const items = c.pastRecord.items;
    const denom = items.filter(i => ['achieved', 'partial', 'notAchieved'].includes(i.status)).length;
    const achieved = items.filter(i => i.status === 'achieved').length;
    trackRecord = denom ? Math.round((achieved / denom) * 100) : null;
  }

  const convictedCount = c.legalCases.convicted.length;
  const integrity = Math.max(0, 5 - convictedCount);

  return { experience, continuity, platformConcreteness, trackRecord, integrity, convictedCount };
}

/* ---------- rendering ---------- */

function renderHeader() {
  $('#metaBar').innerHTML = `
    <span>投票日：${DATA.meta.electionDate}</span>
    <span>資料更新：${DATA.meta.dataAsOf}</span>
    <span>${DATA.meta.scope}</span>
  `;
  $('#disclaimerBox').innerHTML = `<strong>使用須知：</strong>${escapeHtml(DATA.meta.disclaimer)}`;
}

function renderList() {
  const q = ($('#searchInput')?.value || '').trim();
  const district = $('#districtSelect')?.value || 'all';

  const list = DATA.candidates.filter(c => {
    const matchQ = !q || c.name.includes(q) || c.party.includes(q);
    const matchD = district === 'all' || c.district === district;
    return matchQ && matchD;
  });

  $('#view').innerHTML = `
    <div class="filter-bar">
      <label>選區</label>
      <select id="districtSelect" class="filter-select">
        <option value="all">全部</option>
        ${DATA.districts.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('')}
      </select>
      <input id="searchInput" class="search-input" type="text" placeholder="搜尋候選人姓名或政黨…" value="${escapeHtml(q)}">
    </div>
    <div class="section-label">台中市長候選人（${list.length} 位）</div>
    <div class="candidate-grid">
      ${list.map(cardHtml).join('') || '<p style="font-size:12px;color:var(--ink-faint)">查無符合條件的候選人</p>'}
    </div>
  `;

  $('#districtSelect').value = district;
  $('#districtSelect').addEventListener('change', renderList);
  $('#searchInput').addEventListener('input', renderList);
  $('#searchInput').focus();
  $('#searchInput').setSelectionRange(q.length, q.length);
}

function cardHtml(c) {
  const s = computeScores(c);
  const convictionNote = s.convictedCount === 0
    ? '<span class="fact-chip no-conviction">✓ 查無定罪紀錄</span>'
    : `<span class="fact-chip" style="color:var(--red);font-weight:700;">${s.convictedCount} 件已定罪</span>`;
  return `
    <a class="candidate-card" href="#/candidate/${c.id}">
      <div class="card-top">
        <div class="avatar" style="background:${c.partyColor}">${escapeHtml(c.photoInitial)}</div>
        <div>
          <div class="card-name">${escapeHtml(c.name)} <span class="badge" style="background:${c.partyColor}">${escapeHtml(c.partyAbbr)}</span></div>
          <div class="card-position">${escapeHtml(c.currentPosition)}</div>
        </div>
      </div>
      <div class="card-facts">
        <span class="fact-chip">從政 ${c.yearsInPolitics.years} 年</span>
        <span class="fact-chip">${c.electionHistory.filter(e=>e.result==='當選'||e.result==='連任').length} 次當選</span>
        ${convictionNote}
      </div>
    </a>
  `;
}

function scoreRow(name, val, max, formula, naText) {
  if (val === null || val === undefined) {
    return `<div class="score-row">
      <div class="score-name">${name}</div>
      <div class="score-na">${naText || '不適用'}</div>
      <div></div>
      <div class="score-formula">${formula}</div>
    </div>`;
  }
  const pct = Math.round((val / max) * 100);
  return `<div class="score-row">
    <div class="score-name">${name}</div>
    <div class="score-bar-bg"><div class="score-bar-fill" style="width:${pct}%"></div></div>
    <div class="score-val">${val}/${max}</div>
    <div class="score-formula">${formula}</div>
  </div>`;
}

function scorePctRow(name, val, formula) {
  if (val === null || val === undefined) {
    return `<div class="score-row">
      <div class="score-name">${name}</div>
      <div class="score-na">不適用（無可追蹤資料）</div>
      <div></div>
      <div class="score-formula">${formula}</div>
    </div>`;
  }
  return `<div class="score-row">
    <div class="score-name">${name}</div>
    <div class="score-bar-bg"><div class="score-bar-fill" style="width:${val}%"></div></div>
    <div class="score-val">${val}%</div>
    <div class="score-formula">${formula}</div>
  </div>`;
}

function caseBlock(item, kind) {
  const cls = kind === 'convicted' ? 'convicted' : (/待查證|進行|偵查/.test(item.status) ? 'pending' : '');
  return `
    <div class="case-block ${cls}">
      <div class="case-title">${escapeHtml(item.caseName)}</div>
      <div class="case-status">${escapeHtml(item.status)}</div>
      <div class="case-desc">${escapeHtml(item.description)}</div>
      <div class="case-meta">身分：${escapeHtml(item.role)}｜時間：${escapeHtml(item.date)}｜來源：<a href="${item.sourceUrl}" target="_blank" rel="noopener">${escapeHtml(item.source)}</a></div>
    </div>
  `;
}

function renderDetail(id) {
  const c = DATA.candidates.find(x => x.id === id);
  if (!c) { location.hash = '#/'; return; }
  const s = computeScores(c);

  $('#view').innerHTML = `
    <button class="detail-back" onclick="history.back()">← 返回候選人列表</button>

    <div class="detail-header">
      <div class="detail-header-top">
        <div class="avatar-lg" style="background:${c.partyColor}">${escapeHtml(c.photoInitial)}</div>
        <div>
          <div class="detail-name">${escapeHtml(c.name)}</div>
          <div class="detail-position">${escapeHtml(c.currentPosition)}</div>
          <div class="detail-tags">
            <span class="badge" style="background:${c.partyColor}">${escapeHtml(c.party)}</span>
            <span class="fact-chip">${c.birthYear}年生・${escapeHtml(c.birthplace)}</span>
            <span class="fact-chip">從政 ${c.yearsInPolitics.years} 年</span>
          </div>
        </div>
      </div>
      <div class="election-history">
        ${c.electionHistory.map(e => `<span class="eh-item"><b>${e.year}</b> ${escapeHtml(e.office)}－${escapeHtml(e.result)}</span>`).join('')}
      </div>
    </div>

    <div class="card">
      <h3>學歷</h3>
      <ul style="list-style:none;font-size:12.5px;color:var(--ink-soft);">
        ${c.education.map(e => `<li style="padding:3px 0;">・${escapeHtml(e)}</li>`).join('')}
      </ul>
    </div>

    <div class="card">
      <h3>經歷時間軸</h3>
      <ul class="timeline">
        ${c.careerTimeline.map(t => `<li><span class="period">${escapeHtml(t.period)}</span><span class="event">${escapeHtml(t.event)}</span></li>`).join('')}
      </ul>
    </div>

    <div class="card">
      <h3>本次參選政見</h3>
      ${c.currentPlatform.map(g => `
        <div class="platform-group">
          <div class="platform-cat">${escapeHtml(g.category)}</div>
          <ul>${g.items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
        </div>
      `).join('')}
    </div>

    <div class="card">
      <h3>歷年政見追蹤</h3>
      ${!c.pastRecord.applicable ? `<div class="notice-box">${escapeHtml(c.pastRecord.note)}</div>` : ''}
      ${c.pastRecord.items.map(i => `
        <div class="controversy-block">
          <div style="font-size:12.5px;">${escapeHtml(i.label)}</div>
          <div class="case-meta" style="margin-top:4px;">來源：${escapeHtml(i.sourceNote)}</div>
        </div>
      `).join('')}
    </div>

    <div class="card">
      <h3>刑事／民事案件－已定罪</h3>
      ${c.legalCases.convicted.length
        ? c.legalCases.convicted.map(i => caseBlock(i, 'convicted')).join('')
        : '<div class="case-empty">✓ 查無已定罪且判決確定之案件</div>'}
    </div>

    <div class="card">
      <h3>刑事／民事案件－未定罪 / 偵查中 / 已判無罪或不起訴</h3>
      ${c.legalCases.unconvicted.length
        ? c.legalCases.unconvicted.map(i => caseBlock(i, 'unconvicted')).join('')
        : '<div class="case-empty">查無相關紀錄</div>'}
      <div class="notice-box" style="margin-top:8px;">${escapeHtml(c.legalCases.note)}</div>
    </div>

    <div class="card">
      <h3>爭議事件</h3>
      ${c.controversies.length
        ? c.controversies.map(i => `
          <div class="controversy-block">
            <div class="case-title">${escapeHtml(i.title)}</div>
            <div class="case-desc">${escapeHtml(i.description)}</div>
            <div class="case-meta">時間：${escapeHtml(i.date)}｜來源：<a href="${i.sourceUrl}" target="_blank" rel="noopener">${escapeHtml(i.source)}</a></div>
          </div>
        `).join('')
        : '<div class="case-empty">查無相關紀錄</div>'}
    </div>

    <div class="card">
      <h3>評分（公式化計分，非主觀評語）</h3>
      <div class="score-grid">
        ${scoreRow('從政資歷', s.experience, 5, DATA.scoringFramework.dimensions[0].formula)}
        ${scoreRow('選民延續信任度', s.continuity, 5, DATA.scoringFramework.dimensions[1].formula)}
        ${scorePctRow('政見具體度', s.platformConcreteness, DATA.scoringFramework.dimensions[2].formula)}
        ${scorePctRow('歷年政見達成率', s.trackRecord, DATA.scoringFramework.dimensions[3].formula)}
        ${scoreRow('司法清廉紀錄', s.integrity, 5, DATA.scoringFramework.dimensions[4].formula)}
      </div>
    </div>

    <div class="card">
      <h3>資料來源</h3>
      <ul class="source-list">
        ${c.sources.map(s2 => `<li><a href="${s2.url}" target="_blank" rel="noopener">${escapeHtml(s2.title)}</a></li>`).join('')}
      </ul>
    </div>
  `;
}

/* ---------- scoring methodology page ---------- */
function renderMethodology() {
  $('#view').innerHTML = `
    <button class="detail-back" onclick="history.back()">← 返回候選人列表</button>
    <div class="card">
      <h3>評分方式說明</h3>
      <p style="font-size:12px;color:var(--ink-soft);margin-bottom:12px;">${escapeHtml(DATA.scoringFramework.description)}</p>
      ${DATA.scoringFramework.dimensions.map(d => `
        <div class="controversy-block">
          <div class="case-title">${escapeHtml(d.name)}</div>
          <div class="case-desc">計算方式：${escapeHtml(d.formula)}</div>
          <div class="case-meta">注意事項：${escapeHtml(d.caveat)}</div>
        </div>
      `).join('')}
      <div class="notice-box" style="margin-top:10px;">${escapeHtml(DATA.scoringFramework.note)}</div>
    </div>
  `;
}

/* ---------- router ---------- */

function route() {
  const hash = location.hash || '#/';
  if (hash === '#/methodology') {
    renderMethodology();
  } else if (hash.startsWith('#/candidate/')) {
    renderDetail(decodeURIComponent(hash.replace('#/candidate/', '')));
  } else {
    renderList();
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);

fetch('data/candidates.json')
  .then(r => r.json())
  .then(data => {
    DATA = data;
    renderHeader();
    route();
  })
  .catch(err => {
    $('#view').innerHTML = `<p style="color:var(--red);font-size:13px;">資料載入失敗：${escapeHtml(err.message)}</p>`;
  });
