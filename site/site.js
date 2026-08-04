/* =============================================================================
 * 快走水 製品サイト — 費用対効果シミュレーター & お問い合わせフォーム
 *
 * 【計算方針】燃費改善率は「km/L が何%上がるか」として扱う。
 * 燃料消費量は 走行距離 ÷ 燃費 なので、10%改善しても燃料費は10%減るのではなく
 * 1 - 1/1.1 = 約9.1% 減る。景表法の観点から、ここは正しい式で計算している。
 * ========================================================================== */

const SET_PRICE = 30000;   // 1セット単価（税別）
const KM_PER_SET = 20000;  // 1セットの対応走行距離

const el = (id) => document.getElementById(id);

function yenMan(v) {
  if (v == null || !isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 100000000) return (v / 100000000).toFixed(2) + '億円';
  if (abs >= 10000) return Math.round(v / 10000).toLocaleString('ja-JP') + '万円';
  return Math.round(v).toLocaleString('ja-JP') + '円';
}

function calcSim() {
  const units = Number(el('sim-units').value) || 0;
  const monthlyKm = Number(el('sim-km').value) || 0;
  const beforeKmL = Number(el('sim-kmL').value) || 0;
  const price = Number(el('sim-price').value) || 0;
  const rate = Number(el('sim-rate').value) || 0;
  const sets = Number(el('sim-sets').value) || 1;

  el('sim-rate-out').textContent = rate;

  if (!(units > 0 && monthlyKm > 0 && beforeKmL > 0 && price > 0)) {
    ['sim-before', 'sim-after', 'sim-save', 'sim-cost', 'sim-net', 'sim-net2']
      .forEach((id) => (el(id).textContent = '—'));
    return;
  }

  const afterKmL = beforeKmL * (1 + rate / 100);
  const yearlyKm = monthlyKm * 12;

  const fuelBefore = (yearlyKm / beforeKmL) * price * units;
  const fuelAfter = (yearlyKm / afterKmL) * price * units;
  const saving = fuelBefore - fuelAfter;

  const changesPerYear = yearlyKm / KM_PER_SET;
  const productCost = changesPerYear * sets * SET_PRICE * units;
  const net = saving - productCost;

  el('sim-before').textContent = yenMan(fuelBefore);
  el('sim-after').textContent = yenMan(fuelAfter);
  el('sim-save').textContent = yenMan(saving);
  el('sim-cost').textContent = yenMan(productCost);
  el('sim-changes').textContent =
    `年 約${changesPerYear.toFixed(1)}回交換 × ${sets}セット × ${units.toLocaleString()}台`;

  const netEl = el('sim-net');
  netEl.textContent = yenMan(net);
  netEl.classList.toggle('neg', net < 0);
  el('sim-net2').textContent = yenMan(net);
}

/** 入力内容からメール本文を組み立てて、メールソフトを開く */
function buildMailto(form) {
  const g = (n) => (form.elements[n] ? String(form.elements[n].value).trim() : '');
  const lines = [
    '快走水 無料テスト導入について問い合わせます。',
    '',
    `会社名　　　：${g('company')}`,
    `ご担当者名　：${g('name')}`,
    `メール　　　：${g('email')}`,
    `電話番号　　：${g('tel') || '（未記入）'}`,
    `保有台数　　：${g('units') || '（未記入）'} 台`,
    `主な車種　　：${g('vtype')}`,
    '',
    '【ご相談内容】',
    g('message') || '（未記入）',
  ];
  const subject = `【無料テスト導入のご相談】${g('company')}`;
  return `mailto:kaisousui@buzzwall.jp?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
}

document.addEventListener('DOMContentLoaded', () => {
  // シミュレーター
  const simIds = ['sim-units', 'sim-km', 'sim-kmL', 'sim-price', 'sim-rate', 'sim-sets'];
  simIds.forEach((id) => {
    const node = el(id);
    if (node) node.addEventListener('input', calcSim);
  });
  if (el('sim-units')) calcSim();

  // お問い合わせフォーム → メールソフトを開く
  const form = el('contact-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      window.location.href = buildMailto(form);
    });
  }
});
