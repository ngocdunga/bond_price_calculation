import { parseDateVN, formatDateVN, priceFloatingBond, calculateAverageBankRate } from "../utils.js";

const $ = (id) => document.getElementById(id);
const vnd = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
const priceVnd = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });
const shares = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
const inputNumber = (id) => $(id).value.trim() === "" ? NaN : Number($(id).value);

// VPS history prices are quoted in thousands of VND per share.
const PRICE_UNIT = 1000;

export function tradingWindow(now = new Date()) {
  const vietnam = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const cutoff = new Date(Date.UTC(vietnam.getUTCFullYear(), vietnam.getUTCMonth(), vietnam.getUTCDate()));
  if (vietnam.getUTCHours() < 15) cutoff.setUTCDate(cutoff.getUTCDate() - 1);
  while (cutoff.getUTCDay() === 0 || cutoff.getUTCDay() === 6) {
    cutoff.setUTCDate(cutoff.getUTCDate() - 1);
  }
  const start = new Date(cutoff);
  let weekdays = 0;
  while (weekdays < 30) {
    start.setUTCDate(start.getUTCDate() - 1);
    if (start.getUTCDay() !== 0 && start.getUTCDay() !== 6) weekdays++;
  }
  return {
    from: Math.floor(start.getTime() / 1000),
    to: Math.floor(cutoff.getTime() / 1000) + 86400,
    cutoff: cutoff.toISOString().slice(0, 10),
  };
}

export function weightedClosingPrice(data, to) {
  if (data?.s !== "ok" || !Array.isArray(data.t) || !Array.isArray(data.c) || !Array.isArray(data.v)
      || data.t.length !== data.c.length || data.t.length !== data.v.length) {
    throw new Error("The market data response is incomplete.");
  }
  const bars = data.t.map((timestamp, i) => ({ timestamp, close: Number(data.c[i]), volume: Number(data.v[i]) }))
    .filter((bar) => Number.isFinite(bar.timestamp) && bar.timestamp < to
      && Number.isFinite(bar.close) && bar.close > 0
      && Number.isFinite(bar.volume) && bar.volume > 0)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-20);
  if (bars.length < 20) throw new Error(`Only ${bars.length} valid trading sessions were returned; 20 are required.`);
  const volume = bars.reduce((sum, bar) => sum + bar.volume, 0);
  return { price: bars.reduce((sum, bar) => sum + bar.close * bar.volume, 0) / volume * PRICE_UNIT,
    volume,
    bars: bars.map((bar) => ({ timestamp: bar.timestamp, close: bar.close * PRICE_UNIT, volume: bar.volume })),
    first: bars[0].timestamp, last: bars[19].timestamp };
}

export function calculateCollateral(quantity, purchasePrice, stockPrice, bondValue, sharePercent, bondPercent, minimumCr = 100) {
  if (![quantity, purchasePrice, stockPrice, bondValue, sharePercent, bondPercent, minimumCr].every(Number.isFinite)
      || quantity < 0 || purchasePrice <= 0 || stockPrice <= 0 || bondValue <= 0
      || sharePercent < 0 || bondPercent < 0 || sharePercent > 100 || bondPercent > 100
      || minimumCr <= 0 || Math.abs(sharePercent + bondPercent - 100) > 0.001) {
    throw new Error("Enter positive stock and bond values and minimum CR, with shares and bonds ratios totaling 100% for each regime.");
  }
  const investment = quantity * purchasePrice;
  const obligation = investment * 1.15 ** 2;
  const requiredCollateral = obligation * minimumCr / 100;
  const shareAllocation = requiredCollateral * sharePercent / 100;
  const bondAllocation = requiredCollateral * bondPercent / 100;
  const requiredShares = Math.ceil(shareAllocation / stockPrice);
  const requiredBonds = Math.ceil(bondAllocation / bondValue);
  return { quantity, investment, obligation, requiredCollateral, shareAllocation, bondAllocation,
    requiredShares, requiredBonds,
    projectedCr: obligation === 0 ? 0 : (requiredShares * stockPrice + requiredBonds * bondValue) / obligation * 100 };
}

export function calculateBondCollateralPrice(bond, settlementText, bankRates) {
  const settle = parseDateVN(settlementText);
  const issue = parseDateVN(bond.issueDate);
  const maturity = parseDateVN(bond.maturity);
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(settlementText) || !settle
      || formatDateVN(settle) !== settlementText || !issue || !maturity
      || settle < issue || settle >= maturity) {
    throw new Error("Enter a valid settlement date between the bond's issue and maturity dates (DD/MM/YYYY).");
  }
  if (!Number.isFinite(bond.faceValue) || bond.faceValue <= 0) {
    throw new Error("The selected bond has no valid face value.");
  }
  const result = priceFloatingBond({
    fv: bond.faceValue,
    ytm: 0, // Accrued interest is independent of YTM; only r.accrued is used.
    freq: bond.frequency,
    issue,
    settle,
    maturity,
    interestSchedule: bond.interestSchedule,
    baseBankRate: calculateAverageBankRate(bond.referenceBank, bankRates),
    recordingDays: bond.recordDays || 10,
    regime: bond.regime,
  });
  if (!Number.isFinite(result.accrued)) throw new Error("Accrued interest could not be calculated for this bond.");
  return { par: bond.faceValue, accrued: result.accrued,
    price: bond.faceValue + result.accrued, inRecordingPeriod: result.inRecordingPeriod };
}

export function initCollateralTab(bonds, bankRates) {
  let funds = null;
  let market = null;
  let marketSymbol = "";
  const inputIds = ["collateralPurchasePrice", "collateralSettlement", "collateralMinCr", "normalShareRatio", "normalBondRatio", "k250ShareRatio", "k250BondRatio"];
  const results = $("collateralResults");
  const status = $("collateralFetchStatus");
  const history = $("collateralHistory");
  const todayVietnam = new Date(Date.now() + 7 * 60 * 60 * 1000);
  $("collateralSettlement").value = formatDateVN(todayVietnam);

  function renderHistory() {
    $("collateralHistoryTitle").textContent = `${marketSymbol || "Stock"} price history for VWAP20`;
    if (!market) {
      history.textContent = "Fetch stock history to inspect the 20 trading sessions.";
      return;
    }
    const rows = market.bars.map((bar) => `<tr><td>${new Date(bar.timestamp * 1000).toISOString().slice(0, 10)}</td>`
      + `<td>${priceVnd.format(bar.close)}</td><td>${shares.format(bar.volume)}</td>`
      + `<td>${(bar.volume / market.volume * 100).toFixed(2)}%</td></tr>`).join("");
    history.innerHTML = `<p class="muted">VWAP20 here is the volume weighted average of daily closing prices: sum(close × volume) / sum(volume).</p>`
      + `<div class="table-scroll"><table class="table"><thead><tr><th>Date</th><th>Close (VND/share)</th><th>Volume (shares)</th><th>Volume weight</th></tr></thead>`
      + `<tbody>${rows}</tbody><tfoot><tr><th>20 session total / VWAP20</th><td><strong>${priceVnd.format(market.price)}</strong></td>`
      + `<td><strong>${shares.format(market.volume)}</strong></td><td>100%</td></tr></tfoot></table></div>`;
  }

  function render() {
    const stockCode = $("collateralStockCode").value.trim().toUpperCase();
    const bondCode = $("collateralBondCode").value.trim().toUpperCase();
    const purchasePrice = inputNumber("collateralPurchasePrice");
    const bond = bonds.find((item) => item.code === bondCode);
    let bondQuote = null;
    try {
      if (!bond) throw new Error("Select a bond code.");
      bondQuote = calculateBondCollateralPrice(bond, $("collateralSettlement").value.trim(), bankRates);
      $("collateralBondPriceInfo").innerHTML = `<strong>Par:</strong> ${priceVnd.format(bondQuote.par)} VND<br>`
        + `<strong>Accrued interest:</strong> ${priceVnd.format(bondQuote.accrued)} VND<br>`
        + `<strong>Par + AI:</strong> ${priceVnd.format(bondQuote.price)} VND per bond`
        + (bondQuote.inRecordingPeriod ? `<br><span class="warning">Recording period: accrued interest is zero, as in the price calculator.</span>` : "");
    } catch (error) {
      $("collateralBondPriceInfo").textContent = error.message;
    }
    if (!funds) return;
    const minimumCr = inputNumber("collateralMinCr");
    const nShare = inputNumber("normalShareRatio");
    const nBond = inputNumber("normalBondRatio");
    const kShare = inputNumber("k250ShareRatio");
    const kBond = inputNumber("k250BondRatio");
    try {
      if (!bondQuote) throw new Error($("collateralBondPriceInfo").textContent);
      if (!market || marketSymbol !== stockCode) throw new Error("Fetch a 20 session stock price to calculate required shares.");
      const normal = calculateCollateral(funds.normal, purchasePrice, market.price, bondQuote.price, nShare, nBond, minimumCr);
      const k250 = calculateCollateral(funds.K250, purchasePrice, market.price, bondQuote.price, kShare, kBond, minimumCr);
      const row = (label, value, format = vnd) => `<tr><th scope="row">${label}</th><td>${format.format(value)}</td></tr>`;
      const table = (title, item) => `<div class="box collateral-result"><h4>${title}</h4><table class="table"><tbody>`
        + row("Current shares", item.quantity, shares)
        + row("Investment (VND)", item.investment)
        + row("Secured obligation (VND)", item.obligation)
        + row("Required collateral (VND)", item.requiredCollateral)
        + row("Share allocation (VND)", item.shareAllocation)
        + row("Bond allocation (VND)", item.bondAllocation)
        + row("Required collateral shares", item.requiredShares, shares)
        + row("Required collateral bonds", item.requiredBonds, shares)
        + `<tr><th scope="row">Projected CR (%)</th><td>${item.projectedCr.toFixed(2)}</td></tr>`
        + `</tbody></table></div>`;
      results.innerHTML = `<p><strong>${stockCode}</strong> 20 session volume weighted closing price: <strong>${priceVnd.format(market.price)} VND/share</strong></p>`
        + `<p class="muted">Sessions ${new Date(market.first * 1000).toISOString().slice(0, 10)} to ${new Date(market.last * 1000).toISOString().slice(0, 10)} · Bond: ${escapeHtml(bondCode)} · Minimum CR: ${minimumCr}%</p>`
        + `<div class="ratio-grid">${table("Normal", normal)}${table("K250", k250)}</div>`
        + `<p><strong>Total investment:</strong> ${vnd.format(normal.investment + k250.investment)} VND</p>`;
    } catch (error) {
      // Investment amounts remain useful before a market quote is fetched.
      if (Number.isFinite(purchasePrice) && purchasePrice > 0) {
        results.textContent = `Normal: ${vnd.format(funds.normal * purchasePrice)} VND · K250: ${vnd.format(funds.K250 * purchasePrice)} VND · Total: ${vnd.format((funds.normal + funds.K250) * purchasePrice)} VND. ${error.message}`;
      } else {
        results.textContent = error.message;
      }
    }
  }

  for (const id of inputIds) $(id).addEventListener("input", render);
  $("collateralBondCode").addEventListener("change", render);
  $("collateralStockCode").addEventListener("input", () => {
    market = null;
    marketSymbol = "";
    status.textContent = "Fetch market data for the new stock code.";
    renderHistory();
    render();
  });
  $("collateralFetch").addEventListener("click", async () => {
    const symbol = $("collateralStockCode").value.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,12}$/.test(symbol)) {
      status.textContent = "Enter a valid stock code using letters and digits.";
      return;
    }
    market = null;
    marketSymbol = symbol;
    renderHistory();
    const button = $("collateralFetch");
    button.disabled = true;
    status.textContent = `Fetching ${symbol} market data…`;
    render();
    try {
      const window = tradingWindow();
      const url = new URL("https://histdatafeed.vps.com.vn/tradingview/history");
      url.search = new URLSearchParams({ symbol, resolution: "1D", from: String(window.from), to: String(window.to), countback: "30" });
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Market API returned HTTP ${response.status}.`);
      const quote = weightedClosingPrice(await response.json(), window.to);
      if ($("collateralStockCode").value.trim().toUpperCase() !== symbol) return;
      market = quote;
      marketSymbol = symbol;
      status.textContent = `Loaded 20 sessions through ${window.cutoff}.`;
      renderHistory();
      render();
    } catch (error) {
      status.textContent = `${error.message} Try again later.`;
      render();
    } finally {
      button.disabled = false;
    }
  });

  fetch("./funds.json")
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((data) => {
      if (![data.normal, data.K250].every((value) => Number.isSafeInteger(value) && value >= 0)) {
        throw new Error("Invalid fund quantities");
      }
      funds = data;
      $("collateralFundsStatus").textContent = `Normal: ${shares.format(data.normal)} shares · K250: ${shares.format(data.K250)} shares`;
      render();
    })
    .catch((error) => {
      $("collateralFundsStatus").textContent = `Could not load funds.json: ${error.message}`;
      results.textContent = "Fund quantities are unavailable.";
    });
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
