/* =============================================================================
 * 快走水 燃費データベース — アプリ本体 (app.js)
 *
 * データは必ず Store（store.js）経由。localStorage を直接触らないこと。
 * 画面はハッシュルーティング（#/dashboard, #/report/:id など）。
 * ========================================================================== */

/* ---------- 汎用ヘルパ ---------- */

/** HTMLエスケープ。ユーザー入力をテンプレートに埋める箇所では必ず通す */
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function num(v) {
  const n = Number(v);
  return isFinite(n) ? n : null;
}

const FUEL_TYPES = ['軽油', 'ガソリン', 'ハイブリッド', 'その他'];
const ROAD_TYPES = ['混在', '一般', '高速'];

/* ---------- アプリ状態 ---------- */
const State = {
  scopeCompanyId: localStorage.getItem('kaisousui.ui.scope') || '',
  companies: [],
  vehicles: [],
  records: [],
};

async function reload() {
  State.companies = await Store.list('companies');
  State.vehicles = await Store.list('vehicles');
  State.records = await Store.list('records');
  State.companies.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
  State.vehicles.sort((a, b) => (a.plate || '').localeCompare(b.plate || '', 'ja'));
  State.records.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function companyById(id) { return State.companies.find((c) => c.id === id) || null; }
function vehicleById(id) { return State.vehicles.find((v) => v.id === id) || null; }
function companyName(id) { const c = companyById(id); return c ? c.name : '（未所属）'; }

/** 現在の会社フィルタを適用した車両一覧 */
function scopedVehicles() {
  return State.scopeCompanyId
    ? State.vehicles.filter((v) => v.companyId === State.scopeCompanyId)
    : State.vehicles.slice();
}

function recordsOf(vehicleId) {
  return State.records.filter((r) => r.vehicleId === vehicleId);
}

function recordsByVehicleMap(vehicles) {
  const map = {};
  for (const v of vehicles) map[v.id] = [];
  for (const r of State.records) if (map[r.vehicleId]) map[r.vehicleId].push(r);
  return map;
}

/* ---------- SVGグラフ（外部ライブラリ不使用） ---------- */

/** 使用前後の燃費を車両ごとに並べた横棒グラフ */
function barChartBeforeAfter(rows) {
  if (!rows.length) return '<p class="card-note">表示できるデータがありません。</p>';
  const rowH = 34, padL = 150, padR = 70, padT = 26, padB = 8, barH = 11;
  const h = padT + rows.length * rowH + padB;
  const w = 720;
  const max = Math.max(...rows.flatMap((r) => [r.before || 0, r.after || 0])) * 1.15 || 1;
  const x = (v) => padL + ((w - padL - padR) * v) / max;

  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="使用前後の燃費比較">`;
  s += `<text x="${padL}" y="14" class="lbl-strong">燃費 (km/L)</text>`;
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    s += `<line class="gridline" x1="${x(v)}" y1="${padT - 8}" x2="${x(v)}" y2="${h - padB}"/>`;
    s += `<text x="${x(v)}" y="${padT - 12}" text-anchor="middle">${v.toFixed(1)}</text>`;
  }
  rows.forEach((r, i) => {
    const y = padT + i * rowH;
    s += `<text x="${padL - 10}" y="${y + 15}" text-anchor="end" class="lbl-strong">${esc(r.label.slice(0, 16))}</text>`;
    if (r.before) s += `<rect x="${padL}" y="${y + 3}" width="${x(r.before) - padL}" height="${barH}" fill="#9fb3c4" rx="2"/>`;
    if (r.after) s += `<rect x="${padL}" y="${y + 3 + barH + 2}" width="${x(r.after) - padL}" height="${barH}" fill="#0f9d58" rx="2"/>`;
    if (r.rate != null) {
      s += `<text x="${w - padR + 8}" y="${y + 18}" fill="${r.rate >= 0 ? '#0f9d58' : '#c0392b'}" font-weight="700">${fmt.pct(r.rate)}</text>`;
    }
  });
  s += '</svg>';
  s += `<div class="legend" style="margin-top:8px"><span><i style="background:#9fb3c4"></i>使用前</span><span><i style="background:#0f9d58"></i>使用後</span></div>`;
  return s;
}

/** 給油ごとの燃費推移（時系列・使用前後で色分け） */
function lineChartHistory(records, installedAt) {
  const pts = records
    .map((r) => ({ ...r, kmL: recordKmPerL(r) }))
    .filter((r) => r.kmL !== null && r.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 2) return '<p class="card-note">推移グラフには有効な給油記録が2件以上必要です。</p>';

  const w = 720, h = 260, padL = 46, padR = 16, padT = 18, padB = 42;
  const vals = pts.map((p) => p.kmL);
  const min = Math.max(0, Math.min(...vals) * 0.9);
  const max = Math.max(...vals) * 1.08;
  const X = (i) => padL + ((w - padL - padR) * i) / Math.max(1, pts.length - 1);
  const Y = (v) => padT + (h - padT - padB) * (1 - (v - min) / (max - min || 1));

  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="燃費の推移">`;
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) / 4) * i;
    s += `<line class="gridline" x1="${padL}" y1="${Y(v)}" x2="${w - padR}" y2="${Y(v)}"/>`;
    s += `<text x="${padL - 7}" y="${Y(v) + 3}" text-anchor="end">${v.toFixed(1)}</text>`;
  }
  s += `<line class="axis" x1="${padL}" y1="${h - padB}" x2="${w - padR}" y2="${h - padB}"/>`;

  // 施工日の境界線
  const firstAfter = pts.findIndex((p) => p.phase === 'after');
  if (firstAfter > 0) {
    const bx = (X(firstAfter - 1) + X(firstAfter)) / 2;
    s += `<line x1="${bx}" y1="${padT}" x2="${bx}" y2="${h - padB}" stroke="#00a8c8" stroke-width="1.5" stroke-dasharray="5 4"/>`;
    s += `<text x="${bx + 5}" y="${padT + 10}" fill="#0a6ea6" font-weight="700">快走水 施工${installedAt ? '（' + esc(installedAt) + '）' : ''}</text>`;
  }

  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i)},${Y(p.kmL)}`).join(' ');
  s += `<path d="${path}" fill="none" stroke="#0a6ea6" stroke-width="2"/>`;
  pts.forEach((p, i) => {
    s += `<circle cx="${X(i)}" cy="${Y(p.kmL)}" r="4" fill="${p.phase === 'after' ? '#0f9d58' : '#7d93a6'}"/>`;
  });
  // x軸ラベルは最大8個まで間引く
  const step = Math.ceil(pts.length / 8);
  pts.forEach((p, i) => {
    if (i % step) return;
    s += `<text x="${X(i)}" y="${h - padB + 15}" text-anchor="middle">${esc(p.date.slice(5))}</text>`;
  });
  s += '</svg>';
  s += `<div class="legend" style="margin-top:6px"><span><i style="background:#7d93a6"></i>使用前</span><span><i style="background:#0f9d58"></i>使用後</span></div>`;
  return s;
}

/* =============================================================================
 * 画面 1: ダッシュボード
 * ========================================================================== */
function viewDashboard() {
  const vehicles = scopedVehicles();
  const map = recordsByVehicleMap(vehicles);
  const fleet = compareFleet(vehicles, map);

  const rows = vehicles
    .map((v) => {
      const cmp = compareVehicle(map[v.id] || []);
      return { v, cmp };
    })
    .filter((r) => r.cmp.ready)
    .sort((a, b) => b.cmp.improvementRate - a.cmp.improvementRate);

  // 実測燃費から年間削減額を試算（月間走行距離は記録から推定できないため既定値を使う）
  const price = avgFuelPrice(State.records) || 165;
  const cb = fleet.ready
    ? costBenefit({
        beforeKmL: fleet.before.kmPerL,
        afterKmL: fleet.after.kmPerL,
        monthlyKm: 6500,
        fuelPrice: price,
        units: fleet.readyCount || 1,
      })
    : null;

  const kpis = `
    <div class="kpis">
      <div class="kpi">
        <div class="kpi-label">登録車両</div>
        <div class="kpi-value">${vehicles.length}<small>台</small></div>
        <div class="kpi-sub">うち前後比較が可能 ${fleet.readyCount}台</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">使用前 平均燃費</div>
        <div class="kpi-value">${fmt.kmL(fleet.before.kmPerL)}<small>km/L</small></div>
        <div class="kpi-sub">${fleet.before.count}件 / ${fmt.km(fleet.before.distanceKm)}km</div>
      </div>
      <div class="kpi is-good">
        <div class="kpi-label">使用後 平均燃費</div>
        <div class="kpi-value">${fmt.kmL(fleet.after.kmPerL)}<small>km/L</small></div>
        <div class="kpi-sub">${fleet.after.count}件 / ${fmt.km(fleet.after.distanceKm)}km</div>
      </div>
      <div class="kpi is-good">
        <div class="kpi-label">平均改善率</div>
        <div class="kpi-value">${fmt.pct(fleet.improvementRate)}</div>
        <div class="kpi-sub">総距離÷総給油量による加重平均</div>
      </div>
      <div class="kpi is-brand">
        <div class="kpi-label">年間 燃料費削減（試算）</div>
        <div class="kpi-value">${cb ? fmt.yenMan(cb.yearlySaving) : '—'}</div>
        <div class="kpi-sub">${fleet.readyCount}台 / 月6,500km / ${Math.round(price)}円/L 前提</div>
      </div>
    </div>`;

  if (!State.vehicles.length) {
    return kpis + `
      <div class="card"><div class="empty">
        <div class="empty-title">まだデータがありません</div>
        <p>「導入先企業」→「車両」→「燃費記録」の順に登録してください。<br>
           操作を試したい場合は、データ管理からサンプルデータを投入できます。</p>
        <div class="btn-row" style="justify-content:center;margin-top:14px">
          <a class="btn btn-primary" href="#/companies">導入先企業を登録する</a>
          <a class="btn" href="#/data">サンプルデータを投入</a>
        </div>
      </div></div>`;
  }

  const chartRows = rows.slice(0, 12).map((r) => ({
    label: r.v.plate || r.v.model || '(名称未設定)',
    before: r.cmp.before.kmPerL,
    after: r.cmp.after.kmPerL,
    rate: r.cmp.improvementRate,
  }));

  const companyRows = State.companies
    .filter((c) => !State.scopeCompanyId || c.id === State.scopeCompanyId)
    .map((c) => {
      const vs = State.vehicles.filter((v) => v.companyId === c.id);
      const f = compareFleet(vs, recordsByVehicleMap(vs));
      return `<tr>
        <td><a href="#/vehicles?company=${encodeURIComponent(c.id)}">${esc(c.name)}</a></td>
        <td class="num">${vs.length}</td>
        <td class="num">${fmt.kmL(f.before.kmPerL)}</td>
        <td class="num">${fmt.kmL(f.after.kmPerL)}</td>
        <td class="num"><span class="delta ${f.improvementRate == null ? 'na' : f.improvementRate >= 0 ? 'up' : 'down'}">${fmt.pct(f.improvementRate)}</span></td>
      </tr>`;
    }).join('');

  return kpis + `
    <div class="card">
      <div class="card-head"><h2>車両別 改善率ランキング</h2><span class="spacer"></span>
        <span class="card-note">前後どちらの記録もある車両のみ・上位12台</span></div>
      <div class="card-body">${barChartBeforeAfter(chartRows)}</div>
    </div>

    <div class="card">
      <div class="card-head"><h2>導入先企業別サマリー</h2></div>
      <div class="table-wrap"><table class="grid">
        <thead><tr><th>企業名</th><th class="num">車両数</th><th class="num">使用前 km/L</th><th class="num">使用後 km/L</th><th class="num">改善率</th></tr></thead>
        <tbody>${companyRows || '<tr><td colspan="5" class="card-note">企業が登録されていません。</td></tr>'}</tbody>
      </table></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>直近の給油記録</h2><span class="spacer"></span>
        <a class="btn btn-sm" href="#/records">すべて見る</a></div>
      <div class="table-wrap"><table class="grid">
        <thead><tr><th>日付</th><th>車両</th><th>区分</th><th class="num">走行km</th><th class="num">給油L</th><th class="num">km/L</th></tr></thead>
        <tbody>${recentRecordRows(vehicles, 8)}</tbody>
      </table></div>
    </div>`;
}

function recentRecordRows(vehicles, limit) {
  const ids = new Set(vehicles.map((v) => v.id));
  const rows = State.records.filter((r) => ids.has(r.vehicleId)).slice(0, limit);
  if (!rows.length) return '<tr><td colspan="6" class="card-note">記録がありません。</td></tr>';
  return rows.map((r) => {
    const v = vehicleById(r.vehicleId);
    return `<tr>
      <td>${esc(r.date)}</td>
      <td>${esc(v ? v.plate || v.model : '—')}</td>
      <td><span class="badge ${r.phase === 'after' ? 'badge-after' : 'badge-before'}">${r.phase === 'after' ? '使用後' : '使用前'}</span></td>
      <td class="num">${fmt.km(num(r.distanceKm))}</td>
      <td class="num">${fmt.km(num(r.fuelL))}</td>
      <td class="num">${fmt.kmL(recordKmPerL(r))}</td>
    </tr>`;
  }).join('');
}

/* =============================================================================
 * 画面 2: 導入先企業
 * ========================================================================== */
function viewCompanies() {
  const rows = State.companies.map((c) => {
    const vs = State.vehicles.filter((v) => v.companyId === c.id);
    const f = compareFleet(vs, recordsByVehicleMap(vs));
    return `<tr>
      <td><strong>${esc(c.name)}</strong>${c.kana ? `<div class="card-note">${esc(c.kana)}</div>` : ''}</td>
      <td>${esc(c.contactName || '—')}<div class="card-note">${esc(c.contactEmail || '')} ${esc(c.contactTel || '')}</div></td>
      <td class="num">${vs.length}</td>
      <td class="num"><span class="delta ${f.improvementRate == null ? 'na' : f.improvementRate >= 0 ? 'up' : 'down'}">${fmt.pct(f.improvementRate)}</span></td>
      <td class="actions">
        <button class="btn btn-sm" data-act="company-edit" data-id="${esc(c.id)}">編集</button>
        <button class="btn btn-sm btn-danger" data-act="company-del" data-id="${esc(c.id)}">削除</button>
      </td>
    </tr>`;
  }).join('');

  return `
    <div class="card">
      <div class="card-head"><h2>導入先企業</h2><span class="spacer"></span>
        <button class="btn btn-primary" data-act="company-new">＋ 企業を追加</button></div>
      <div class="table-wrap"><table class="grid">
        <thead><tr><th>企業名</th><th>担当者</th><th class="num">車両数</th><th class="num">改善率</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="card-note">まだ登録がありません。</td></tr>'}</tbody>
      </table></div>
    </div>`;
}

function companyForm(c = {}) {
  return `
    <div class="form-grid">
      <div class="field wide"><label>企業名 <span class="req">*</span></label>
        <input name="name" value="${esc(c.name)}" required placeholder="例）〇〇運輸株式会社"></div>
      <div class="field wide"><label>ふりがな</label><input name="kana" value="${esc(c.kana)}"></div>
      <div class="field"><label>担当者名</label><input name="contactName" value="${esc(c.contactName)}"></div>
      <div class="field"><label>メール</label><input name="contactEmail" type="email" value="${esc(c.contactEmail)}"></div>
      <div class="field"><label>電話</label><input name="contactTel" value="${esc(c.contactTel)}"></div>
      <div class="field wide"><label>備考</label><textarea name="note" rows="2">${esc(c.note)}</textarea></div>
    </div>`;
}

/* =============================================================================
 * 画面 3: 車両
 * ========================================================================== */
function viewVehicles(params) {
  const filterCompany = params.get('company') || State.scopeCompanyId || '';
  const vehicles = filterCompany ? State.vehicles.filter((v) => v.companyId === filterCompany) : State.vehicles;

  const rows = vehicles.map((v) => {
    const cmp = compareVehicle(recordsOf(v.id));
    return `<tr>
      <td><strong>${esc(v.plate || '(番号未設定)')}</strong>
        <div class="card-note">${esc([v.maker, v.model, v.modelYear].filter(Boolean).join(' '))}</div></td>
      <td>${esc(companyName(v.companyId))}</td>
      <td>${esc(v.fuelType || '—')}<div class="card-note">${v.engineCc ? esc(v.engineCc) + 'cc' : ''}</div></td>
      <td>${esc(v.installedAt || '—')}<div class="card-note">${v.sets ? esc(v.sets) + 'セット' : ''}</div></td>
      <td class="num">${fmt.kmL(cmp.before.kmPerL)}</td>
      <td class="num">${fmt.kmL(cmp.after.kmPerL)}</td>
      <td class="num"><span class="delta ${cmp.improvementRate == null ? 'na' : cmp.improvementRate >= 0 ? 'up' : 'down'}">${fmt.pct(cmp.improvementRate)}</span></td>
      <td class="actions">
        <a class="btn btn-sm" href="#/report/${esc(v.id)}">レポート</a>
        <button class="btn btn-sm" data-act="vehicle-edit" data-id="${esc(v.id)}">編集</button>
        <button class="btn btn-sm btn-danger" data-act="vehicle-del" data-id="${esc(v.id)}">削除</button>
      </td>
    </tr>`;
  }).join('');

  return `
    <div class="card">
      <div class="card-head"><h2>車両一覧</h2>
        <span class="badge badge-brand">${vehicles.length}台</span>
        <span class="spacer"></span>
        <button class="btn btn-primary" data-act="vehicle-new">＋ 車両を追加</button></div>
      <div class="table-wrap"><table class="grid">
        <thead><tr><th>車両番号</th><th>所属企業</th><th>燃料</th><th>施工日</th>
          <th class="num">使用前</th><th class="num">使用後</th><th class="num">改善率</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="card-note">車両が登録されていません。</td></tr>'}</tbody>
      </table></div>
    </div>`;
}

function vehicleForm(v = {}) {
  const opts = State.companies.map((c) => `<option value="${esc(c.id)}" ${c.id === v.companyId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  return `
    <div class="form-grid">
      <div class="field wide"><label>所属企業 <span class="req">*</span></label>
        <select name="companyId" required><option value="">選択してください</option>${opts}</select>
        ${State.companies.length ? '' : '<div class="hint">先に「導入先企業」を登録してください。</div>'}</div>
      <div class="field"><label>車両番号／管理番号 <span class="req">*</span></label>
        <input name="plate" value="${esc(v.plate)}" required placeholder="例）品川 100 か 12-34"></div>
      <div class="field"><label>メーカー</label><input name="maker" value="${esc(v.maker)}" placeholder="三菱ふそう"></div>
      <div class="field"><label>車種</label><input name="model" value="${esc(v.model)}" placeholder="ファイター8t"></div>
      <div class="field"><label>年式</label><input name="modelYear" value="${esc(v.modelYear)}" placeholder="平成15年式"></div>
      <div class="field"><label>排気量 (cc)</label><input name="engineCc" type="number" min="0" value="${esc(v.engineCc)}" placeholder="7540"></div>
      <div class="field"><label>燃料種別</label>
        <select name="fuelType">${FUEL_TYPES.map((f) => `<option ${f === v.fuelType ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
      <div class="field"><label>快走水 施工日</label><input name="installedAt" type="date" value="${esc(v.installedAt)}">
        <div class="hint">この日より前が「使用前」、後が「使用後」の目安</div></div>
      <div class="field"><label>使用セット数</label><input name="sets" type="number" min="0" step="1" value="${esc(v.sets)}" placeholder="1">
        <div class="hint">〜4,000cc:1／4,000〜8,000cc:2／8,000cc〜:3</div></div>
      <div class="field wide"><label>備考</label><textarea name="note" rows="2">${esc(v.note)}</textarea></div>
    </div>`;
}

/* =============================================================================
 * 画面 4: 燃費記録
 * ========================================================================== */
function viewRecords() {
  const vehicles = scopedVehicles();
  const ids = new Set(vehicles.map((v) => v.id));
  const rows = State.records.filter((r) => ids.has(r.vehicleId)).map((r) => {
    const v = vehicleById(r.vehicleId);
    return `<tr>
      <td>${esc(r.date)}</td>
      <td>${esc(v ? v.plate : '—')}<div class="card-note">${esc(v ? companyName(v.companyId) : '')}</div></td>
      <td><span class="badge ${r.phase === 'after' ? 'badge-after' : 'badge-before'}">${r.phase === 'after' ? '使用後' : '使用前'}</span></td>
      <td class="num">${fmt.km(num(r.distanceKm))}</td>
      <td class="num">${fmt.km(num(r.fuelL))}</td>
      <td class="num"><strong>${fmt.kmL(recordKmPerL(r))}</strong></td>
      <td class="num">${r.fuelPrice ? fmt.yen(num(r.fuelPrice)) : '—'}</td>
      <td>${esc(r.roadType || '—')}</td>
      <td class="actions">
        <button class="btn btn-sm" data-act="record-edit" data-id="${esc(r.id)}">編集</button>
        <button class="btn btn-sm btn-danger" data-act="record-del" data-id="${esc(r.id)}">削除</button>
      </td>
    </tr>`;
  }).join('');

  return `
    <div class="card">
      <div class="card-head"><h2>燃費記録（満タン法）</h2><span class="spacer"></span>
        <button class="btn" data-act="csv-export">CSV書き出し</button>
        <button class="btn btn-primary" data-act="record-new">＋ 記録を追加</button></div>
      <div class="card-body" style="padding-bottom:0">
        <p class="card-note" style="margin-top:0">満タン給油ごとに「前回給油からの走行距離」と「今回の給油量」を入力します。燃費は自動計算されます。</p>
      </div>
      <div class="table-wrap"><table class="grid">
        <thead><tr><th>日付</th><th>車両</th><th>区分</th><th class="num">走行km</th><th class="num">給油L</th>
          <th class="num">km/L</th><th class="num">単価</th><th>道路</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="9" class="card-note">記録がありません。</td></tr>'}</tbody>
      </table></div>
    </div>`;
}

function recordForm(r = {}) {
  const opts = State.vehicles.map((v) =>
    `<option value="${esc(v.id)}" ${v.id === r.vehicleId ? 'selected' : ''}>${esc(v.plate)}（${esc(companyName(v.companyId))}）</option>`
  ).join('');
  return `
    <div class="form-grid">
      <div class="field wide"><label>車両 <span class="req">*</span></label>
        <select name="vehicleId" required><option value="">選択してください</option>${opts}</select></div>
      <div class="field"><label>給油日 <span class="req">*</span></label>
        <input name="date" type="date" required value="${esc(r.date || todayStr())}"></div>
      <div class="field"><label>区分 <span class="req">*</span></label>
        <select name="phase" required>
          <option value="before" ${r.phase !== 'after' ? 'selected' : ''}>使用前（快走水なし）</option>
          <option value="after" ${r.phase === 'after' ? 'selected' : ''}>使用後（快走水あり）</option>
        </select></div>
      <div class="field"><label>走行距離 (km) <span class="req">*</span></label>
        <input name="distanceKm" type="number" step="0.1" min="0.1" required value="${esc(r.distanceKm)}" placeholder="113.4">
        <div class="hint">前回の満タン給油からの距離</div></div>
      <div class="field"><label>給油量 (L) <span class="req">*</span></label>
        <input name="fuelL" type="number" step="0.01" min="0.01" required value="${esc(r.fuelL)}" placeholder="37"></div>
      <div class="field"><label>燃料単価 (円/L)</label><input name="fuelPrice" type="number" step="0.1" min="0" value="${esc(r.fuelPrice)}" placeholder="165"></div>
      <div class="field"><label>走行道路</label>
        <select name="roadType">${ROAD_TYPES.map((t) => `<option ${t === r.roadType ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>ドライバー</label><input name="driver" value="${esc(r.driver)}"></div>
      <div class="field wide"><label>備考</label><textarea name="note" rows="2">${esc(r.note)}</textarea></div>
    </div>`;
}

/* =============================================================================
 * 画面 5: 車両レポート（印刷／PDF用）
 * ========================================================================== */
function viewReport(vehicleId) {
  const v = vehicleById(vehicleId);
  if (!v) return '<div class="card"><div class="empty">車両が見つかりません。</div></div>';
  const recs = recordsOf(v.id);
  const cmp = compareVehicle(recs);
  const price = avgFuelPrice(recs) || 165;

  const monthlyKm = 6500;
  const cb = cmp.ready
    ? costBenefit({
        beforeKmL: cmp.before.kmPerL,
        afterKmL: cmp.after.kmPerL,
        monthlyKm,
        fuelPrice: price,
        units: 1,
        setsPerVehicle: num(v.sets) || 1,
      })
    : null;

  return `
    <div class="btn-row no-print" style="margin-bottom:14px">
      <a class="btn" href="#/vehicles">← 車両一覧へ戻る</a>
      <button class="btn btn-primary" data-act="print">🖨 印刷 / PDF保存</button>
    </div>

    <div class="card"><div class="card-body">
      <div class="report-head">
        <div>
          <h2 class="report-title">快走水 導入効果レポート</h2>
          <div class="report-meta">
            <strong>${esc(companyName(v.companyId))}</strong> ／ 車両：${esc(v.plate)}
            ${[v.maker, v.model, v.modelYear].filter(Boolean).map(esc).join(' ')}
            ${v.engineCc ? '／ ' + esc(v.engineCc) + 'cc' : ''} ${v.fuelType ? '／ ' + esc(v.fuelType) : ''}<br>
            施工日：${esc(v.installedAt || '未登録')}　使用セット数：${esc(v.sets || '—')}　出力日：${todayStr()}
          </div>
        </div>
        <div class="report-logo"><strong>快走水</strong>バズウォール合同会社<br>kaisousui@buzzwall.jp</div>
      </div>

      <div class="compare" style="margin-top:18px">
        <div class="compare-box">
          <div class="cb-label">使用前 平均燃費</div>
          <div class="cb-value">${fmt.kmL(cmp.before.kmPerL)}<span class="cb-unit"> km/L</span></div>
          <div class="cb-sub">給油${cmp.before.count}回／走行 ${fmt.km(cmp.before.distanceKm)}km／給油 ${fmt.km(cmp.before.fuelL)}L</div>
        </div>
        <div class="compare-arrow">▶</div>
        <div class="compare-box after">
          <div class="cb-label">使用後 平均燃費</div>
          <div class="cb-value">${fmt.kmL(cmp.after.kmPerL)}<span class="cb-unit"> km/L</span></div>
          <div class="cb-sub">給油${cmp.after.count}回／走行 ${fmt.km(cmp.after.distanceKm)}km／給油 ${fmt.km(cmp.after.fuelL)}L</div>
        </div>
      </div>

      <div class="kpis" style="margin-top:14px">
        <div class="kpi is-good"><div class="kpi-label">燃費改善率</div>
          <div class="kpi-value">${fmt.pct(cmp.improvementRate)}</div>
          <div class="kpi-sub">総走行距離÷総給油量で算出</div></div>
        <div class="kpi"><div class="kpi-label">燃料単価（記録平均）</div>
          <div class="kpi-value">${Math.round(price)}<small>円/L</small></div>
          <div class="kpi-sub">未入力時は165円/Lを仮定</div></div>
        <div class="kpi is-brand"><div class="kpi-label">年間削減額（1台・試算）</div>
          <div class="kpi-value">${cb ? fmt.yenMan(cb.yearlySaving) : '—'}</div>
          <div class="kpi-sub">月間${monthlyKm.toLocaleString()}km走行を仮定</div></div>
        <div class="kpi is-brand"><div class="kpi-label">製品費を引いた年間差益</div>
          <div class="kpi-value">${cb ? fmt.yenMan(cb.yearlyNetProfit) : '—'}</div>
          <div class="kpi-sub">年${cb ? cb.changesPerYear.toFixed(1) : '—'}回交換で算出</div></div>
      </div>
    </div></div>

    <div class="card">
      <div class="card-head"><h2>燃費の推移</h2></div>
      <div class="card-body">${lineChartHistory(recs, v.installedAt)}</div>
    </div>

    <div class="card">
      <div class="card-head"><h2>給油記録の明細</h2></div>
      <div class="table-wrap"><table class="grid">
        <thead><tr><th>日付</th><th>区分</th><th class="num">走行km</th><th class="num">給油L</th>
          <th class="num">km/L</th><th class="num">単価</th><th>道路</th><th>ドライバー</th></tr></thead>
        <tbody>${recs.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).map((r) => `
          <tr>
            <td>${esc(r.date)}</td>
            <td><span class="badge ${r.phase === 'after' ? 'badge-after' : 'badge-before'}">${r.phase === 'after' ? '使用後' : '使用前'}</span></td>
            <td class="num">${fmt.km(num(r.distanceKm))}</td>
            <td class="num">${fmt.km(num(r.fuelL))}</td>
            <td class="num"><strong>${fmt.kmL(recordKmPerL(r))}</strong></td>
            <td class="num">${r.fuelPrice ? fmt.yen(num(r.fuelPrice)) : '—'}</td>
            <td>${esc(r.roadType || '—')}</td>
            <td>${esc(r.driver || '—')}</td>
          </tr>`).join('') || '<tr><td colspan="8" class="card-note">記録がありません。</td></tr>'}
        </tbody>
      </table></div>
      <div class="card-body">
        <div class="disclaimer">
          【本レポートについて】燃費は満タン法（走行距離÷給油量）で算出した実測値です。
          燃費は積載量・走行経路・渋滞・気温・運転方法・タイヤ空気圧などの条件によって変動するため、
          本レポートの数値は同一条件下での測定を保証するものではありません。
          年間削減額は上記の走行距離・燃料単価を前提とした試算であり、金額を保証するものではありません。
        </div>
      </div>
    </div>`;
}

/* =============================================================================
 * 画面 6: データ管理
 * ========================================================================== */
function viewData() {
  const mode = Store.mode === 'local'
    ? 'このブラウザの localStorage に保存されています。'
    : 'サーバーAPIに保存されています。';
  return `
    <div class="card">
      <div class="card-head"><h2>バックアップ / 復元</h2></div>
      <div class="card-body">
        <p class="card-note" style="margin-top:0">現在のデータ保存先：<strong>${esc(mode)}</strong>
          ブラウザのデータを消すと失われるため、<strong>作業のたびにJSONで書き出して保管</strong>してください。</p>
        <div class="btn-row" style="margin-top:12px">
          <button class="btn btn-primary" data-act="json-export">JSONで書き出し（全データ）</button>
          <button class="btn" data-act="json-import">JSONから復元（上書き）</button>
          <button class="btn" data-act="json-merge">JSONから追加（マージ）</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>CSV 入出力</h2></div>
      <div class="card-body">
        <p class="card-note" style="margin-top:0">列は
          <code>企業名, 車両番号, 日付, 区分, 走行距離km, 給油量L, 燃料単価, 道路, ドライバー, 備考</code>。
          区分は「使用前」または「使用後」。取り込み時、存在しない企業・車両は自動作成されます。</p>
        <div class="btn-row" style="margin-top:12px">
          <button class="btn btn-primary" data-act="csv-export">CSVで書き出し</button>
          <button class="btn" data-act="csv-import">CSVから取り込み</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>サンプルデータ</h2></div>
      <div class="card-body">
        <p class="card-note" style="margin-top:0">既存資料の実測値（三菱ふそうファイター8t の2008年テスト、スズキ ソリオ、レクサス IS350）を
          もとにしたデモ用データを投入します。動作確認用なので、本番運用前に削除してください。</p>
        <div class="btn-row" style="margin-top:12px">
          <button class="btn" data-act="seed">サンプルデータを投入</button>
          <button class="btn btn-danger" data-act="wipe">全データを削除</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>統計</h2></div>
      <div class="card-body">
        <div class="kpis" style="margin:0">
          <div class="kpi"><div class="kpi-label">企業</div><div class="kpi-value">${State.companies.length}</div></div>
          <div class="kpi"><div class="kpi-label">車両</div><div class="kpi-value">${State.vehicles.length}</div></div>
          <div class="kpi"><div class="kpi-label">給油記録</div><div class="kpi-value">${State.records.length}</div></div>
        </div>
      </div>
    </div>`;
}

/* =============================================================================
 * モーダル（フォーム）
 * ========================================================================== */
function openModal(title, bodyHtml, onSubmit) {
  const dlg = $('#modal');
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  dlg.returnValue = '';
  const form = $('#modal-form');

  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = {};
    for (const [k, val] of new FormData(form).entries()) data[k] = typeof val === 'string' ? val.trim() : val;
    try {
      await onSubmit(data);
      dlg.close();
      await refresh();
    } catch (err) {
      alert('保存に失敗しました：' + err.message);
    }
  };
  dlg.showModal();
}

/* =============================================================================
 * CSV
 * ========================================================================== */
const CSV_HEADER = ['企業名', '車両番号', '日付', '区分', '走行距離km', '給油量L', '燃料単価', '道路', 'ドライバー', '備考'];

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function buildCsv() {
  const lines = [CSV_HEADER.join(',')];
  for (const r of State.records.slice().reverse()) {
    const v = vehicleById(r.vehicleId);
    lines.push([
      companyName(v ? v.companyId : ''), v ? v.plate : '', r.date,
      r.phase === 'after' ? '使用後' : '使用前',
      r.distanceKm, r.fuelL, r.fuelPrice || '', r.roadType || '', r.driver || '', r.note || '',
    ].map(csvCell).join(','));
  }
  return '﻿' + lines.join('\r\n'); // BOM付き（Excelでの文字化け防止）
}

/** ダブルクォート対応の簡易CSVパーサ */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', inQ = false;
  const s = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

async function importCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('データ行がありません。');
  const head = rows[0].map((h) => h.trim());
  const idx = (name) => head.indexOf(name);
  const need = ['企業名', '車両番号', '日付', '区分', '走行距離km', '給油量L'];
  for (const n of need) if (idx(n) < 0) throw new Error('必須列がありません：' + n);

  let created = 0;
  for (const r of rows.slice(1)) {
    const cName = (r[idx('企業名')] || '').trim();
    const plate = (r[idx('車両番号')] || '').trim();
    if (!cName || !plate) continue;

    let c = State.companies.find((x) => x.name === cName);
    if (!c) { c = await Store.create('companies', { name: cName }); State.companies.push(c); }

    let v = State.vehicles.find((x) => x.plate === plate && x.companyId === c.id);
    if (!v) { v = await Store.create('vehicles', { companyId: c.id, plate, fuelType: '軽油' }); State.vehicles.push(v); }

    await Store.create('records', {
      vehicleId: v.id,
      date: (r[idx('日付')] || '').trim(),
      phase: (r[idx('区分')] || '').includes('後') ? 'after' : 'before',
      distanceKm: num(r[idx('走行距離km')]),
      fuelL: num(r[idx('給油量L')]),
      fuelPrice: idx('燃料単価') >= 0 ? num(r[idx('燃料単価')]) : null,
      roadType: idx('道路') >= 0 ? (r[idx('道路')] || '').trim() : '',
      driver: idx('ドライバー') >= 0 ? (r[idx('ドライバー')] || '').trim() : '',
      note: idx('備考') >= 0 ? (r[idx('備考')] || '').trim() : '',
    });
    created++;
  }
  return created;
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function pickFile(accept, onText) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.onchange = () => {
    const f = input.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => onText(String(reader.result));
    reader.readAsText(f, 'utf-8');
  };
  input.click();
}

/* =============================================================================
 * サンプルデータ（既存資料の実測値ベース）
 * ========================================================================== */
async function seedSampleData() {
  const c1 = await Store.create('companies', {
    name: '小須田牧場（デモ）', contactName: '—',
    note: '2008年1月30日実施の実車テスト記録（資料：ラジエーター用 三菱ふそう8t）',
  });
  const c2 = await Store.create('companies', { name: '個人ユーザー（デモ）', note: 'ピースイ資料の乗用車事例' });

  const v1 = await Store.create('vehicles', {
    companyId: c1.id, plate: 'ふそう8t-01', maker: '三菱ふそう', model: 'ファイター8t',
    modelYear: '平成15年式', engineCc: 7540, fuelType: '軽油', sets: 2, installedAt: '2008-01-30',
    note: '型式 KL-FK64FLZ / 原動機 6M60 / 車両総重量 13,530kg',
  });
  const v2 = await Store.create('vehicles', {
    companyId: c2.id, plate: 'ソリオ-01', maker: 'スズキ', model: 'ソリオ',
    engineCc: 1200, fuelType: 'ガソリン', sets: 1, installedAt: '2020-10-01',
  });
  const v3 = await Store.create('vehicles', {
    companyId: c2.id, plate: 'IS350-01', maker: 'レクサス', model: 'IS350',
    engineCc: 3500, fuelType: 'ガソリン', sets: 1, installedAt: '2020-10-15',
  });

  const R = (vehicleId, date, phase, distanceKm, fuelL, extra = {}) =>
    Store.create('records', { vehicleId, date, phase, distanceKm, fuelL, roadType: '混在', fuelPrice: 165, ...extra });

  // 三菱ふそう8t（資料の実測3本）
  await R(v1.id, '2008-01-28', 'before', 113.4, 37, { note: 'eco-WATER未使用' });
  await R(v1.id, '2008-01-30', 'after', 112.2, 22.15, { note: 'eco-WATER添加後 1回目' });
  await R(v1.id, '2008-02-01', 'after', 111.4, 20.5, { note: 'eco-WATER添加後 2回目' });

  // ソリオ 10.5 → 14 km/L
  await R(v2.id, '2020-09-10', 'before', 420, 40);
  await R(v2.id, '2020-09-24', 'before', 399, 38);
  await R(v2.id, '2020-10-08', 'after', 420, 30);
  await R(v2.id, '2020-10-22', 'after', 434, 31);

  // レクサスIS350 6.4 → 7.0 km/L
  await R(v3.id, '2020-10-02', 'before', 320, 50);
  await R(v3.id, '2020-10-20', 'after', 350, 50);
  await R(v3.id, '2020-11-05', 'after', 315, 45);
}

/* =============================================================================
 * ルーティング & 描画
 * ========================================================================== */
const ROUTES = {
  '/dashboard': { title: 'ダッシュボード', render: viewDashboard },
  '/companies': { title: '導入先企業', render: viewCompanies },
  '/vehicles': { title: '車両', render: viewVehicles },
  '/records': { title: '燃費記録', render: viewRecords },
  '/data': { title: 'データ管理', render: viewData },
};

function currentRoute() {
  const raw = (location.hash || '#/dashboard').slice(1);
  const [path, query] = raw.split('?');
  return { path, params: new URLSearchParams(query || '') };
}

function renderScopeSelect() {
  const opts = ['<option value="">全社（自社ビュー）</option>']
    .concat(State.companies.map((c) =>
      `<option value="${esc(c.id)}" ${c.id === State.scopeCompanyId ? 'selected' : ''}>${esc(c.name)}</option>`));
  $('#scope-select').innerHTML = opts.join('');
}

async function refresh() {
  await reload();
  render();
}

function render() {
  const { path, params } = currentRoute();
  renderScopeSelect();

  let title, html;
  if (path.startsWith('/report/')) {
    const id = decodeURIComponent(path.slice('/report/'.length));
    title = '導入効果レポート';
    html = viewReport(id);
  } else {
    const route = ROUTES[path] || ROUTES['/dashboard'];
    title = route.title;
    html = route.render(params);
  }

  $('#page-title').textContent = title;
  $('#view').innerHTML = html;

  const navPath = path.startsWith('/report/') ? '/vehicles' : path;
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + navPath));
  window.scrollTo(0, 0);
}

/* =============================================================================
 * イベント（委譲で1箇所にまとめる）
 * ========================================================================== */
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id;

  switch (act) {
    case 'company-new':
      openModal('導入先企業を追加', companyForm(), (d) => Store.create('companies', d));
      break;
    case 'company-edit': {
      const c = await Store.get('companies', id);
      openModal('導入先企業を編集', companyForm(c), (d) => Store.update('companies', id, d));
      break;
    }
    case 'company-del': {
      const c = await Store.get('companies', id);
      const n = State.vehicles.filter((v) => v.companyId === id).length;
      if (confirm(`「${c.name}」を削除します。\n配下の車両${n}台と、その燃費記録もすべて削除されます。\nよろしいですか？`)) {
        await Store.remove('companies', id);
        if (State.scopeCompanyId === id) setScope('');
        await refresh();
      }
      break;
    }

    case 'vehicle-new':
      if (!State.companies.length) { alert('先に「導入先企業」を1社登録してください。'); location.hash = '#/companies'; return; }
      openModal('車両を追加', vehicleForm({ companyId: State.scopeCompanyId }), (d) => Store.create('vehicles', d));
      break;
    case 'vehicle-edit': {
      const v = await Store.get('vehicles', id);
      openModal('車両を編集', vehicleForm(v), (d) => Store.update('vehicles', id, d));
      break;
    }
    case 'vehicle-del': {
      const v = await Store.get('vehicles', id);
      const n = recordsOf(id).length;
      if (confirm(`車両「${v.plate}」を削除します。\n燃費記録${n}件も削除されます。よろしいですか？`)) {
        await Store.remove('vehicles', id);
        await refresh();
      }
      break;
    }

    case 'record-new':
      if (!State.vehicles.length) { alert('先に車両を登録してください。'); location.hash = '#/vehicles'; return; }
      openModal('燃費記録を追加', recordForm(), (d) => Store.create('records', d));
      break;
    case 'record-edit': {
      const r = await Store.get('records', id);
      openModal('燃費記録を編集', recordForm(r), (d) => Store.update('records', id, d));
      break;
    }
    case 'record-del':
      if (confirm('この燃費記録を削除します。よろしいですか？')) { await Store.remove('records', id); await refresh(); }
      break;

    case 'print':
      window.print();
      break;

    case 'json-export': {
      const db = await Store.exportAll();
      download(`快走水DB_${todayStr()}.json`, JSON.stringify(db, null, 2), 'application/json');
      break;
    }
    case 'json-import':
    case 'json-merge': {
      const merge = act === 'json-merge';
      if (!merge && !confirm('現在のデータをすべて置き換えます。よろしいですか？')) return;
      pickFile('.json,application/json', async (text) => {
        try {
          await Store.importAll(JSON.parse(text), { merge });
          await refresh();
          alert('読み込みが完了しました。');
        } catch (err) { alert('読み込みに失敗しました：' + err.message); }
      });
      break;
    }

    case 'csv-export':
      download(`快走水_燃費記録_${todayStr()}.csv`, buildCsv(), 'text/csv;charset=utf-8');
      break;
    case 'csv-import':
      pickFile('.csv,text/csv', async (text) => {
        try {
          const n = await importCsv(text);
          await refresh();
          alert(`${n}件の記録を取り込みました。`);
        } catch (err) { alert('取り込みに失敗しました：' + err.message); }
      });
      break;

    case 'seed':
      if (confirm('デモ用のサンプルデータを追加します。よろしいですか？')) {
        await seedSampleData();
        await refresh();
        location.hash = '#/dashboard';
      }
      break;
    case 'wipe':
      if (confirm('すべてのデータを削除します。この操作は取り消せません。\n先にJSONで書き出しましたか？')
        && confirm('本当に削除してよろしいですか？')) {
        await Store.reset();
        setScope('');
        await refresh();
      }
      break;
  }
});

function setScope(id) {
  State.scopeCompanyId = id;
  localStorage.setItem('kaisousui.ui.scope', id);
}

/**
 * デモモード。共有リンク用のビルド（公開用/）が app.js の前に
 * window.KAISOUSUI_DEMO = true を立てる。ローカルの実ファイルでは常に false。
 * 空のDBで開かれたときだけサンプルデータを入れ、デモである旨のバナーを出す。
 */
function showDemoBanner() {
  const bar = document.createElement('div');
  bar.style.cssText =
    'background:#fdf0e8;border-bottom:1px solid #f3d5c2;color:#8a3d12;' +
    'padding:9px 26px;font-size:12.5px;line-height:1.7';
  bar.innerHTML =
    '<strong>デモ表示</strong>：これは共有用のプレビューです。既存資料の実測値をもとにしたサンプルデータが入っています。' +
    'ここでの編集はご覧になっている方の端末にのみ保存され、他の方には影響しません。';
  document.querySelector('.main').prepend(bar);
}

document.addEventListener('DOMContentLoaded', async () => {
  $('#scope-select').addEventListener('change', (e) => { setScope(e.target.value); render(); });
  $('#modal-cancel').addEventListener('click', () => $('#modal').close());
  window.addEventListener('hashchange', render);
  await refresh();

  if (window.KAISOUSUI_DEMO) {
    if (!State.vehicles.length) {
      await seedSampleData();
      await refresh();
    }
    showDemoBanner();
  }
});
