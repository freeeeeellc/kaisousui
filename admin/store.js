/* =============================================================================
 * 快走水 燃費データベース — データアクセス層 (store.js)
 *
 * 【重要】アプリ本体(app.js)は localStorage を直接触らない。
 * データの読み書きは必ずこの Store 経由で行う。全メソッドは async。
 *
 * ■ サーバー＋DB へ移行するとき
 *   このファイル末尾の
 *       const Store = new LocalStore();
 *   を
 *       const Store = new ApiStore('/api');
 *   に差し替えるだけでよい。app.js の変更は不要。
 *   ApiStore が期待するサーバー側 REST 仕様は下の ApiStore クラスに記載。
 *
 * ■ スキーマ（サーバー移行時のテーブル定義にそのまま対応させる想定）
 *   companies : 導入先企業
 *     id, name, kana, contactName, contactEmail, contactTel, note,
 *     createdAt, updatedAt
 *   vehicles  : 車両
 *     id, companyId, plate(車両番号/管理番号), maker, model, modelYear,
 *     engineCc, fuelType('軽油'|'ガソリン'|'ハイブリッド'|'その他'),
 *     sets(快走水セット数), installedAt(施工日 YYYY-MM-DD), note,
 *     createdAt, updatedAt
 *   records   : 給油／燃費記録（満タン法）
 *     id, vehicleId, date(YYYY-MM-DD), phase('before'|'after'),
 *     distanceKm(前回給油からの走行距離), fuelL(給油量),
 *     fuelPrice(円/L, 任意), roadType('一般'|'高速'|'混在'),
 *     driver, note, createdAt, updatedAt
 *
 *   ※ 燃費(km/L) は distanceKm / fuelL で都度算出する（保存しない）。
 * ========================================================================== */

const SCHEMA_VERSION = 1;
const STORAGE_KEY = 'kaisousui.db.v1';
const COLLECTIONS = ['companies', 'vehicles', 'records'];

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function emptyDb() {
  return { schemaVersion: SCHEMA_VERSION, companies: [], vehicles: [], records: [] };
}

/* -----------------------------------------------------------------------------
 * LocalStore : ブラウザの localStorage に保存する実装（現行）
 * -------------------------------------------------------------------------- */
class LocalStore {
  constructor(key = STORAGE_KEY) {
    this.key = key;
    this.mode = 'local';
    this._migrate();
  }

  _raw() {
    const s = localStorage.getItem(this.key);
    if (!s) return emptyDb();
    try {
      const db = JSON.parse(s);
      for (const c of COLLECTIONS) if (!Array.isArray(db[c])) db[c] = [];
      return db;
    } catch (e) {
      console.error('DBの読み込みに失敗しました。空のDBで起動します。', e);
      return emptyDb();
    }
  }

  _save(db) {
    localStorage.setItem(this.key, JSON.stringify(db));
  }

  /* 将来スキーマが変わったらここでバージョン別の変換を足す */
  _migrate() {
    const db = this._raw();
    if (db.schemaVersion !== SCHEMA_VERSION) {
      db.schemaVersion = SCHEMA_VERSION;
      this._save(db);
    } else if (!localStorage.getItem(this.key)) {
      this._save(db);
    }
  }

  async list(collection, where) {
    const rows = this._raw()[collection] || [];
    if (!where) return rows.slice();
    return rows.filter((r) => Object.keys(where).every((k) => r[k] === where[k]));
  }

  async get(collection, id) {
    return (this._raw()[collection] || []).find((r) => r.id === id) || null;
  }

  async create(collection, data) {
    const db = this._raw();
    const row = { ...data, id: data.id || uid(), createdAt: nowIso(), updatedAt: nowIso() };
    db[collection].push(row);
    this._save(db);
    return row;
  }

  async update(collection, id, patch) {
    const db = this._raw();
    const i = db[collection].findIndex((r) => r.id === id);
    if (i < 0) throw new Error('対象が見つかりません: ' + collection + '/' + id);
    db[collection][i] = { ...db[collection][i], ...patch, id, updatedAt: nowIso() };
    this._save(db);
    return db[collection][i];
  }

  /* 会社を消したら配下の車両と記録も消す（参照整合性） */
  async remove(collection, id) {
    const db = this._raw();
    if (collection === 'companies') {
      const vIds = db.vehicles.filter((v) => v.companyId === id).map((v) => v.id);
      db.records = db.records.filter((r) => !vIds.includes(r.vehicleId));
      db.vehicles = db.vehicles.filter((v) => v.companyId !== id);
    } else if (collection === 'vehicles') {
      db.records = db.records.filter((r) => r.vehicleId !== id);
    }
    db[collection] = db[collection].filter((r) => r.id !== id);
    this._save(db);
    return true;
  }

  async exportAll() {
    return this._raw();
  }

  async importAll(db, { merge = false } = {}) {
    const incoming = { ...emptyDb(), ...db, schemaVersion: SCHEMA_VERSION };
    if (!merge) {
      this._save(incoming);
      return incoming;
    }
    const cur = this._raw();
    for (const c of COLLECTIONS) {
      const ids = new Set(cur[c].map((r) => r.id));
      cur[c] = cur[c].concat((incoming[c] || []).filter((r) => !ids.has(r.id)));
    }
    this._save(cur);
    return cur;
  }

  async reset() {
    this._save(emptyDb());
    return true;
  }
}

/* -----------------------------------------------------------------------------
 * ApiStore : サーバー＋DB 版（移行用のひな形。現時点では未使用）
 *
 * 想定するサーバー側 REST エンドポイント
 *   GET    /api/:collection            → 配列を返す（?companyId=... 等で絞り込み）
 *   GET    /api/:collection/:id        → 1件返す
 *   POST   /api/:collection            → 作成（id/createdAt/updatedAt はサーバー採番）
 *   PATCH  /api/:collection/:id        → 部分更新
 *   DELETE /api/:collection/:id        → 削除（配下も削除する責務はサーバー側）
 *   GET    /api/export                 → 全件ダンプ
 *   POST   /api/import                 → 一括投入
 *
 * 認証は fetch の credentials: 'include'（セッションCookie）を想定。
 * 導入先企業アカウントには、サーバー側で companyId によるスコープを掛ける。
 * -------------------------------------------------------------------------- */
class ApiStore {
  constructor(base = '/api') {
    this.base = base;
    this.mode = 'api';
  }

  async _fetch(path, options = {}) {
    const res = await fetch(this.base + path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!res.ok) throw new Error('APIエラー ' + res.status + ' ' + path);
    return res.status === 204 ? null : res.json();
  }

  async list(collection, where) {
    const q = where ? '?' + new URLSearchParams(where).toString() : '';
    return this._fetch('/' + collection + q);
  }
  async get(collection, id) {
    return this._fetch('/' + collection + '/' + id);
  }
  async create(collection, data) {
    return this._fetch('/' + collection, { method: 'POST', body: JSON.stringify(data) });
  }
  async update(collection, id, patch) {
    return this._fetch('/' + collection + '/' + id, { method: 'PATCH', body: JSON.stringify(patch) });
  }
  async remove(collection, id) {
    await this._fetch('/' + collection + '/' + id, { method: 'DELETE' });
    return true;
  }
  async exportAll() {
    return this._fetch('/export');
  }
  async importAll(db, opts = {}) {
    return this._fetch('/import', { method: 'POST', body: JSON.stringify({ db, ...opts }) });
  }
  async reset() {
    throw new Error('サーバー版では画面からの全削除は許可していません。');
  }
}

/* ===== ここを差し替えるだけでサーバー＋DBに移行できる ===== */
const Store = new LocalStore();
// const Store = new ApiStore('/api');
