/* =============================================================================
 * 快走水 燃費データベース — 集計ロジック (calc.js)
 *
 * 燃費の平均は「単純平均」ではなく【総走行距離 ÷ 総給油量】の加重平均で出す。
 * 給油ごとの距離がバラつくため、単純平均だと短距離の給油に引っ張られて実態と
 * ズレるため。営業資料として出す数字なので、ここは厳密にしている。
 * ========================================================================== */

/** 1レコードの燃費(km/L)。不正値は null */
function recordKmPerL(r) {
  const d = Number(r.distanceKm);
  const f = Number(r.fuelL);
  if (!isFinite(d) || !isFinite(f) || d <= 0 || f <= 0) return null;
  return d / f;
}

/** レコード配列 → { kmPerL, distanceKm, fuelL, count } の加重平均集計 */
function aggregate(records) {
  let distanceKm = 0;
  let fuelL = 0;
  let count = 0;
  for (const r of records) {
    if (recordKmPerL(r) === null) continue;
    distanceKm += Number(r.distanceKm);
    fuelL += Number(r.fuelL);
    count++;
  }
  return {
    count,
    distanceKm,
    fuelL,
    kmPerL: fuelL > 0 ? distanceKm / fuelL : null,
  };
}

/** 給油記録から燃料単価(円/L)の平均を出す。未入力なら null */
function avgFuelPrice(records) {
  const vals = records.map((r) => Number(r.fuelPrice)).filter((v) => isFinite(v) && v > 0);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/**
 * 車両1台分の使用前後比較。
 * @returns {{before, after, improvementRate:number|null, ready:boolean}}
 *   improvementRate は「使用後が使用前より何%良くなったか」(0.10 = 10%改善)
 *   ready は before/after 両方に有効データがあるか
 */
function compareVehicle(records) {
  const before = aggregate(records.filter((r) => r.phase === 'before'));
  const after = aggregate(records.filter((r) => r.phase === 'after'));
  const ready = before.kmPerL !== null && after.kmPerL !== null;
  return {
    before,
    after,
    ready,
    improvementRate: ready ? after.kmPerL / before.kmPerL - 1 : null,
  };
}

/**
 * 複数車両をまとめた集計。
 * 全体の改善率は「全車の総距離・総給油量」から出す（台数の単純平均ではない）。
 */
function compareFleet(vehicles, recordsByVehicle) {
  const beforeAll = [];
  const afterAll = [];
  let readyCount = 0;
  for (const v of vehicles) {
    const recs = recordsByVehicle[v.id] || [];
    const cmp = compareVehicle(recs);
    if (cmp.ready) readyCount++;
    for (const r of recs) (r.phase === 'before' ? beforeAll : afterAll).push(r);
  }
  const before = aggregate(beforeAll);
  const after = aggregate(afterAll);
  const ready = before.kmPerL !== null && after.kmPerL !== null;
  return {
    before,
    after,
    ready,
    readyCount,
    vehicleCount: vehicles.length,
    improvementRate: ready ? after.kmPerL / before.kmPerL - 1 : null,
  };
}

/**
 * 費用対効果の試算。
 * @param {number} beforeKmL  使用前燃費
 * @param {number} afterKmL   使用後燃費
 * @param {number} monthlyKm  1台あたり月間走行距離
 * @param {number} fuelPrice  燃料単価 円/L
 * @param {number} units      台数
 * @param {number} setsPerVehicle 1台あたりの快走水セット数
 * @param {number} setPrice   1セット単価（税別）
 * @param {number} kmPerSet   1セットの対応走行距離
 */
function costBenefit({
  beforeKmL,
  afterKmL,
  monthlyKm,
  fuelPrice,
  units = 1,
  setsPerVehicle = 1,
  setPrice = 30000,
  kmPerSet = 20000,
}) {
  if (!(beforeKmL > 0) || !(afterKmL > 0) || !(monthlyKm > 0) || !(fuelPrice > 0)) return null;

  const monthlyFuelBefore = (monthlyKm / beforeKmL) * fuelPrice * units;
  const monthlyFuelAfter = (monthlyKm / afterKmL) * fuelPrice * units;
  const monthlySaving = monthlyFuelBefore - monthlyFuelAfter;
  const yearlySaving = monthlySaving * 12;

  // 年間の交換回数 = 年間走行距離 ÷ 1セットの対応距離
  const yearlyKm = monthlyKm * 12;
  const changesPerYear = yearlyKm / kmPerSet;
  const yearlyProductCost = changesPerYear * setsPerVehicle * setPrice * units;

  return {
    monthlyFuelBefore,
    monthlyFuelAfter,
    monthlySaving,
    yearlySaving,
    yearlyFuelBefore: monthlyFuelBefore * 12,
    yearlyFuelAfter: monthlyFuelAfter * 12,
    changesPerYear,
    yearlyProductCost,
    yearlyNetProfit: yearlySaving - yearlyProductCost,
    roi: yearlyProductCost > 0 ? (yearlySaving - yearlyProductCost) / yearlyProductCost : null,
  };
}

/* ---- 表示用フォーマッタ ---- */
const fmt = {
  km(v) {
    return v == null || !isFinite(v) ? '—' : v.toLocaleString('ja-JP', { maximumFractionDigits: 1 });
  },
  kmL(v) {
    return v == null || !isFinite(v) ? '—' : v.toFixed(2);
  },
  pct(v) {
    if (v == null || !isFinite(v)) return '—';
    const s = (v * 100).toFixed(1);
    return (v > 0 ? '+' : '') + s + '%';
  },
  yen(v) {
    if (v == null || !isFinite(v)) return '—';
    return '¥' + Math.round(v).toLocaleString('ja-JP');
  },
  /** 大きい金額を「約1,300万円」形式に */
  yenMan(v) {
    if (v == null || !isFinite(v)) return '—';
    if (Math.abs(v) >= 100000000) return (v / 100000000).toFixed(2) + '億円';
    if (Math.abs(v) >= 10000) return Math.round(v / 10000).toLocaleString('ja-JP') + '万円';
    return Math.round(v).toLocaleString('ja-JP') + '円';
  },
  date(s) {
    return s || '—';
  },
};
