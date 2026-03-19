/* dataLoader.js — public/data/ 폴더의 파일을 가져와서 파싱/매칭/집계 */
import { useState, useEffect } from "react";

/* ═══ CSV Parser (handles multiline quoted fields) ═══ */
const parseCSV = (text) => {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  /* Split into logical rows (respecting quotes) */
  const rows = []; let cur = "", inQ = false;
  for (const ch of text) {
    if (ch === '"') inQ = !inQ;
    if ((ch === "\n" || ch === "\r") && !inQ) {
      if (cur.trim()) rows.push(cur);
      cur = "";
    } else if (ch !== "\r") {
      cur += ch;
    }
  }
  if (cur.trim()) rows.push(cur);
  if (rows.length < 2) return [];
  const splitLine = (line) => {
    const r = []; let c = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { r.push(c.trim().replace(/^"|"$/g, "").replace(/\n/g, " ")); c = ""; }
      else c += ch;
    }
    r.push(c.trim().replace(/^"|"$/g, "").replace(/\n/g, " "));
    return r;
  };
  const headers = splitLine(rows[0]);
  return rows.slice(1).map(line => {
    const vals = splitLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || "").trim(); });
    return obj;
  });
};

/* ═══ Workshop → 제품명 자동 매칭 ═══ */
const WS_OVERRIDE = {
  "레트로 아케이드 프로": "레트로 아케이드 Pro (Y/M)",
  "마이크로비트 시계키트V2": "마이크로비트 스마트 시계 키트 V2 (Y/6M)",
  "웨어러블키트 (create AI)": "마이크로비트 웨어러블 (Y/7M)",
  "RC카 축구게임": "RC카 축구 확장 패키지 (Y/5M)",
  "마이크로비트 컬러 무드등 키트": "마이크로비트 IPS 컬러 LCD (Y/4M)",
  "음성인식센서": "음성 인식 모듈 (Y/4M)",
  "허스키렌즈V2": "허스키렌즈2 (Y/M)",
  "축음기 DIY 키트": "_SKIP_",
  "스포츠 코딩키트": "_SKIP_",
};

const cleanName = (s) => s.replace(/\(Y?\/?[\dM]*\)/g, "").replace(/\s+/g, "").toLowerCase();

function matchWsProduct(wsName, productNames) {
  if (WS_OVERRIDE[wsName] !== undefined) {
    return WS_OVERRIDE[wsName] === "_SKIP_" ? null : WS_OVERRIDE[wsName];
  }
  const wsClean = cleanName(wsName);
  let best = null, bestScore = 0;
  for (const pn of productNames) {
    const pnClean = cleanName(pn);
    if (wsClean === pnClean) return pn;
    if (pnClean.includes(wsClean)) {
      const score = wsClean.length / pnClean.length;
      if (score > bestScore) { bestScore = score; best = pn; }
    }
    if (wsClean.includes(pnClean)) {
      const score = pnClean.length / wsClean.length;
      if (score > bestScore) { bestScore = score; best = pn; }
    }
    const wsWords = new Set(wsName.toLowerCase().replace(/[()]/g, "").split(/\s+/));
    const pnWords = new Set(pn.replace(/\(Y?\/?[\dM]*\)/g, "").toLowerCase().split(/\s+/).filter(w => w.length > 1));
    if (pnWords.size > 0) {
      let overlap = 0;
      for (const w of wsWords) { if (pnWords.has(w)) overlap++; }
      const score = overlap / Math.max(pnWords.size, 1);
      if (score > bestScore) { bestScore = score; best = pn; }
    }
  }
  return bestScore > 0.4 ? best : null;
}

/* ═══ Sales 집계 ═══ */
const OPEN_MARKETS = ["쿠팡", "인터파크", "샵N", "네이버페이", "옥션", "G마켓", "11번가", "위메프", "티몬", "쇼핑몰가상업체"];

function processSales(rawRows, masterMap) {
  // masterMap: pcode → productName
  const byProduct = {}; // productName → { months: { "2025-01": { sales_s, sales_sh, gpd_s, gpd_sh, qty_s, qty_sh, orders_s, orders_sh, buyers:{} } } }

  for (const row of rawRows) {
    const pcode = (row["PROD_CODE"] || "").trim();
    const productName = masterMap[pcode];
    if (!productName) continue;

    const team = (row["TEAM2 (그룹)"] || "").trim();
    const isSales = ["Sales", "EMS", "기업몰"].includes(team);
    const isShop = ["SHOP", "EMS_SHOP"].includes(team);
    if (!isSales && !isShop) continue;

    const dateStr = (row["PO_REGDATE"] || "").trim();
    if (!dateStr) continue;
    const ymd = dateStr.substring(0, 10).split("-");
    if (ymd.length < 2) continue;
    const monthKey = `${ymd[0]}-${ymd[1].padStart(2, "0")}`;

    const amt = parseFloat(row["POITEM_AMOUNT_KRW"] || "0") || 0;
    const gpd = parseFloat(row["POITEM_PROFIT"] || "0") || 0;
    const qty = parseInt(row["POITEM_QTY"] || "0") || 0;
    const poId = (row["PO_ID"] || "").trim();
    const buyer = (row["PO_BUYER_COMP_NAME"] || "").trim();

    if (!byProduct[productName]) byProduct[productName] = { months: {} };
    const pm = byProduct[productName].months;
    if (!pm[monthKey]) pm[monthKey] = { ss: 0, sh: 0, gs: 0, gh: 0, qs: 0, qh: 0, os: new Set(), oh: new Set(), ois: 0, oih: 0, buyers: {} };

    const m = pm[monthKey];
    if (isSales) {
      m.ss += amt; m.gs += gpd; m.qs += qty; if (poId) m.os.add(poId); m.ois++;
      if (buyer && !OPEN_MARKETS.some(om => buyer.includes(om))) {
        m.buyers[buyer] = (m.buyers[buyer] || 0) + amt;
      }
    } else {
      m.sh += amt; m.gh += gpd; m.qh += qty; if (poId) m.oh.add(poId); m.oih++;
    }
  }

  // Convert Sets to counts and build final structure
  const result = {};
  for (const [pn, data] of Object.entries(byProduct)) {
    const months = [];
    for (const [mk, m] of Object.entries(data.months).sort((a, b) => a[0].localeCompare(b[0]))) {
      months.push({
        month: mk,
        salesSales: m.ss, salesShop: m.sh, sales: m.ss + m.sh,
        gpdSales: m.gs, gpdShop: m.gh, gpd: m.gs + m.gh,
        qtySales: m.qs, qtyShop: m.qh, qty: m.qs + m.qh,
        ordersSales: m.os.size, ordersShop: m.oh.size, orders: m.os.size + m.oh.size,
        oiSales: m.ois, oiShop: m.oih,
        topBuyers: Object.entries(m.buyers).sort((a, b) => b[1] - a[1]).slice(0, 5),
      });
    }
    result[pn] = months;
  }
  return result;
}

/* ═══ Inventory 집계 ═══ */
function processInventory(rawRows, masterMap) {
  // masterMap: pcode → productName
  const byProduct = {};
  for (const row of rawRows) {
    const pcode = (row["Prodcode"] || "").trim();
    const productName = masterMap[pcode];
    if (!productName) continue;

    /* Headers may contain spaces from newline cleanup */
    const stock = parseInt(row["재고 수량"] || "0") || 0;
    const outgoing = parseInt(row["출고 예정"] || "0") || 0;
    const hold = parseInt(row["HOLD"] || "0") || 0;
    const available = parseInt(row["가용 재고"] || "0") || 0;
    const optimal = parseInt(row["적정 재고 수량"] || "0") || 0;

    if (!byProduct[productName]) byProduct[productName] = { stock: 0, outgoing: 0, hold: 0, available: 0, optimal: 0 };
    const p = byProduct[productName];
    p.stock += stock; p.outgoing += outgoing; p.hold += hold; p.available += available; p.optimal += optimal;
  }
  return byProduct;
}

/* ═══ Workshop 집계 ═══ */
function processWorkshop(rawRows, productNames) {
  const result = [];
  for (const row of rawRows) {
    const ymRaw = (row["년 월"] || "").trim();
    const yMatch = ymRaw.match(/(\d{4})년\s*(\d{1,2})월?/);
    if (!yMatch) continue;
    const year = parseInt(yMatch[1]);
    const month = parseInt(yMatch[2]);

    const dateRaw = (row["날짜"] || "").trim();
    const topic = (row["주제"] || "").trim();
    const wsProduct = (row["상품명"] || "").trim();
    const category = (row["카테고리"] || "").trim();

    const applicants = parseInt(row["신청자"] || "0") || 0;
    const attendees = parseInt(row["참석자"] || "0") || 0;
    const orders = parseInt(row["오더건수"] || "0") || 0;
    const amount = parseFloat(row["금액"] || "0") || 0;

    // Extract DMD from topic
    const dmdMatch = topic.match(/\(Y\/(\d+)M?\)/);
    const dmd = dmdMatch ? parseInt(dmdMatch[1]) : 0;

    // Match product
    const matchedProduct = matchWsProduct(wsProduct, productNames);

    result.push({
      id: `ws-${result.length}`,
      y: year, m: month, d: dateRaw,
      ct: category, tp: topic, pd: wsProduct,
      matchedProduct: matchedProduct,
      dm: dmd, ap: applicants, at: attendees, od: orders, am: amount,
    });
  }
  return result;
}

/* ═══ Build pcode → productName map ═══ */
function buildMasterMap(productMaster) {
  const map = {};
  for (const [productName, codes] of Object.entries(productMaster)) {
    for (const entry of codes) {
      map[entry.pcode] = productName;
    }
  }
  return map;
}

/* ═══ Build SL-compatible product list for Sales tab ═══ */
function buildSalesItems(salesByProduct, productInfo, inventoryByProduct) {
  const items = [];
  const curY = 2026, curM = 3, prevM = 2;

  for (const [pn, info] of Object.entries(productInfo)) {
    const months = salesByProduct[pn] || [];
    if (months.length === 0 && !info.annualTarget) continue;

    // Aggregate
    let yg = 0, yr = 0, pyg = 0, pyr = 0, cg2 = 0, cr2 = 0, pvg = 0, pvr = 0, pmg = 0, pmr = 0;
    for (const m of months) {
      const [y, mo] = m.month.split("-").map(Number);
      if (y === curY && mo <= curM) { yr += m.sales / 1e6; yg += m.gpd / 1e6; }
      if (y === curY - 1 && mo <= curM) { pyr += m.sales / 1e6; pyg += m.gpd / 1e6; }
      if (y === curY && mo === curM) { cr2 += m.sales / 1e6; cg2 += m.gpd / 1e6; }
      if (y === curY - 1 && mo === curM) { pvr += m.sales / 1e6; pvg += m.gpd / 1e6; }
      if (y === curY && mo === prevM) { pmr += m.sales / 1e6; pmg += m.gpd / 1e6; }
    }

    const inv = inventoryByProduct[pn] || {};

    items.push({
      id: `p-${items.length}`,
      n: pn,
      g: info.group,
      b: info.board,
      t: String(info.annualTarget || 0),
      ld: info.launchDate,
      md: months,
      stock: inv.available || inv.stock || 0,
      stockDetail: inv,
      r: { yg, yr, pyg, pyr, cg: cg2, cr: cr2, pvg, pvr, pmg, pmr },
    });
  }

  return items.sort((a, b) => (b.r.yr || 0) - (a.r.yr || 0));
}

/* ═══ Main Hook ═══ */
export function useData() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const [masterRes, infoRes, salesRes, invRes, wsRes] = await Promise.all([
          fetch("/data/product_master.json").then(r => r.ok ? r.json() : {}),
          fetch("/data/product_info.json").then(r => r.ok ? r.json() : {}),
          fetch("/data/sales_raw.csv").then(r => r.ok ? r.text() : ""),
          fetch("/data/inventory.csv").then(r => r.ok ? r.text() : ""),
          fetch("/data/workshop.csv").then(r => r.ok ? r.text() : ""),
        ]);

        const masterMap = buildMasterMap(masterRes);
        const productNames = Object.keys(infoRes);

        const salesRaw = salesRes ? parseCSV(salesRes) : [];
        const invRaw = invRes ? parseCSV(invRes) : [];
        const wsRaw = wsRes ? parseCSV(wsRes) : [];

        const salesByProduct = processSales(salesRaw, masterMap);
        const inventoryByProduct = processInventory(invRaw, masterMap);
        const workshops = processWorkshop(wsRaw, productNames);
        const salesItems = buildSalesItems(salesByProduct, infoRes, inventoryByProduct);

        setData({
          productMaster: masterRes,
          productInfo: infoRes,
          salesItems,
          salesByProduct,
          inventoryByProduct,
          workshops,
          masterMap,
        });
      } catch (e) {
        console.error("Data loading error:", e);
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return { loading, error, data };
}
