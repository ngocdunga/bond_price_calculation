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
  const rawPrice = bars.reduce((sum, bar) => sum + bar.close * bar.volume, 0) / volume * PRICE_UNIT;
  const price = Math.floor(rawPrice);
  if (!Number.isFinite(price) || price <= 0) throw new Error("The calculated VWAP20 is invalid.");
  return { price, rawPrice,
    volume,
    bars: bars.map((bar) => ({ timestamp: bar.timestamp, close: bar.close * PRICE_UNIT, volume: bar.volume })),
    first: bars[0].timestamp, last: bars[19].timestamp };
}

export function calculateCollateral(quantity, purchasePrice, stockPrice, bondValue, sharePercent, bondPercent, minimumCr = 50) {
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

export function calculateGivenCollateral(quantity, purchasePrice, stockPrice, bondPrice, givenShares, givenBonds) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isFinite(purchasePrice) || purchasePrice <= 0
      || !Number.isFinite(stockPrice) || stockPrice <= 0 || !Number.isFinite(bondPrice) || bondPrice <= 0
      || !Number.isSafeInteger(givenShares) || givenShares < 0 || !Number.isSafeInteger(givenBonds) || givenBonds < 0) {
    throw new Error("Enter non-negative whole numbers of shares and bonds and positive prices.");
  }
  const securedValue = quantity * purchasePrice * 1.15 ** 2;
  const stockValue = givenShares * stockPrice;
  const bondValue = givenBonds * bondPrice;
  const collateralValue = stockValue + bondValue;
  if (![securedValue, collateralValue].every(Number.isFinite)) {
    throw new Error("The entered amounts are too large to calculate.");
  }
  return { securedValue, stockValue, bondValue, collateralValue, cr: collateralValue / securedValue * 100 };
}

export function parseInvestors(data) {
  if (!data || !Array.isArray(data.investors)) {
    throw new Error("funds.json must contain an investors array.");
  }
  return data.investors.map((entry, index) => {
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    const regimeText = String(entry?.regime ?? "").trim().toLowerCase();
    const regime = regimeText === "normal" ? "normal" : regimeText === "k250" ? "K250" : null;
    const purchaseShares = entry?.purchaseShares;
    const heldShares = entry?.heldShares ?? null;
    const heldBonds = entry?.heldBonds ?? null;
    if (!name || !regime || !Number.isSafeInteger(purchaseShares) || purchaseShares <= 0
        || (heldShares !== null && (!Number.isSafeInteger(heldShares) || heldShares < 0))
        || (heldBonds !== null && (!Number.isSafeInteger(heldBonds) || heldBonds < 0))) {
      throw new Error(`Invalid investor at position ${index + 1} in funds.json.`);
    }
    return { name, regime, purchaseShares, heldShares, heldBonds };
  });
}

export function summarizeRequirements(items, stockPrice, bondPrice) {
  const total = { quantity: 0, investment: 0, obligation: 0, requiredCollateral: 0,
    shareAllocation: 0, bondAllocation: 0, requiredShares: 0, requiredBonds: 0 };
  for (const item of items) {
    for (const key of Object.keys(total)) total[key] += item[key];
  }
  total.projectedCr = total.obligation > 0
    ? (total.requiredShares * stockPrice + total.requiredBonds * bondPrice) / total.obligation * 100
    : null;
  return total;
}

function totalPurchaseShares(investors, regime) {
  return investors.reduce((sum, investor) => sum + (investor.regime === regime ? investor.purchaseShares : 0), 0);
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
  let investors = null;
  let market = null;
  let marketSymbol = "";
  const inputIds = ["collateralPurchasePrice", "collateralSettlement", "collateralMinCr", "normalShareRatio", "normalBondRatio", "k250ShareRatio", "k250BondRatio"];
  const results = $("collateralResults");
  const investorInputs = $("collateralInvestorInputs");
  const investorResults = $("collateralInvestorResults");
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
      + `<tbody>${rows}</tbody><tfoot><tr><th>20 session total / raw VWAP20</th><td>${priceVnd.format(market.rawPrice)}</td>`
      + `<td><strong>${shares.format(market.volume)}</strong></td><td>100%</td></tr>`
      + `<tr><th>VWAP20 used (rounded down)</th><td><strong>${vnd.format(market.price)}</strong></td><td></td><td></td></tr></tfoot></table></div>`;
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
    if (!investors) return;
    const minimumCr = inputNumber("collateralMinCr");
    const nShare = inputNumber("normalShareRatio");
    const nBond = inputNumber("normalBondRatio");
    const kShare = inputNumber("k250ShareRatio");
    const kBond = inputNumber("k250BondRatio");
    try {
      if (!bondQuote) throw new Error($("collateralBondPriceInfo").textContent);
      if (!market || marketSymbol !== stockCode) throw new Error("Fetch a 20 session stock price to calculate required shares.");
      let requirements = null;
      let requirementError = "";
      try {
        requirements = investors.map((investor) => calculateCollateral(investor.purchaseShares, purchasePrice,
          market.price, bondQuote.price, investor.regime === "normal" ? nShare : kShare,
          investor.regime === "normal" ? nBond : kBond, minimumCr));
      } catch (error) {
        requirementError = error.message;
      }
      const actuals = investors.map((investor, index) => {
        const heldShares = $(`investorHeldShares${index}`).value.trim();
        const heldBonds = $(`investorHeldBonds${index}`).value.trim();
        if (!heldShares && !heldBonds) return null;
        if (!heldShares || !heldBonds) return { error: "Enter both held counts" };
        try {
          return calculateGivenCollateral(investor.purchaseShares, purchasePrice, market.price,
            bondQuote.price, inputNumber(`investorHeldShares${index}`), inputNumber(`investorHeldBonds${index}`));
        } catch (error) {
          return { error: error.message };
        }
      });
      const investorRows = investors.map((investor, index) => {
        const required = requirements?.[index];
        const actual = actuals[index];
        const securedValue = investor.purchaseShares * purchasePrice * 1.15 ** 2;
        return `<tr><th scope="row">${escapeHtml(investor.name)}</th><td>${investor.regime}</td>`
          + `<td>${shares.format(investor.purchaseShares)}</td><td>${Number.isFinite(securedValue) ? vnd.format(securedValue) : "—"}</td>`
          + `<td>${required ? shares.format(required.requiredShares) : "—"}</td>`
          + `<td>${required ? shares.format(required.requiredBonds) : "—"}</td>`
          + `<td>${actual && !actual.error ? vnd.format(actual.collateralValue) : "—"}</td>`
          + `<td>${actual ? (actual.error || `${actual.cr.toFixed(2)}%`) : "—"}</td></tr>`;
      });
      const actualSummary = (indices) => {
        if (!indices.length || !indices.every((index) => actuals[index] && !actuals[index].error)) return "—";
        const collateral = indices.reduce((sum, index) => sum + actuals[index].collateralValue, 0);
        const secured = indices.reduce((sum, index) => sum + actuals[index].securedValue, 0);
        return `${(collateral / secured * 100).toFixed(2)}%`;
      };
      const normalIndices = investors.flatMap((investor, index) => investor.regime === "normal" ? [index] : []);
      const k250Indices = investors.flatMap((investor, index) => investor.regime === "K250" ? [index] : []);
      const totalIndices = investors.map((_, index) => index);
      investorResults.innerHTML = `<div class="table-scroll"><table class="table"><thead><tr><th>Investor</th><th>Regime</th>`
        + `<th>Purchase shares</th><th>Secured value (VND)</th><th>Required shares</th><th>Required bonds</th>`
        + `<th>Held collateral (VND)</th><th>CR</th></tr></thead><tbody>${investorRows.join("")}</tbody></table></div>`
        + `<p><strong>CR from entered holdings:</strong> Normal ${actualSummary(normalIndices)} · K250 ${actualSummary(k250Indices)} · Total ${actualSummary(totalIndices)}</p>`
        + (requirementError ? `<p class="warning">Required quantities: ${requirementError}</p>` : "");
      if (requirementError) throw new Error(requirementError);
      const normal = summarizeRequirements(normalIndices.map((index) => requirements[index]), market.price, bondQuote.price);
      const k250 = summarizeRequirements(k250Indices.map((index) => requirements[index]), market.price, bondQuote.price);
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
        + `<tr><th scope="row">Projected CR (%)</th><td>${item.projectedCr === null ? "—" : item.projectedCr.toFixed(2)}</td></tr>`
        + `</tbody></table></div>`;
      results.innerHTML = `<p><strong>${stockCode}</strong> VWAP20 rounded down: <strong>${vnd.format(market.price)} VND/share</strong></p>`
        + `<p class="muted">Sessions ${new Date(market.first * 1000).toISOString().slice(0, 10)} to ${new Date(market.last * 1000).toISOString().slice(0, 10)} · Bond: ${escapeHtml(bondCode)} · Minimum CR: ${minimumCr}%</p>`
        + `<div class="ratio-grid">${table("Normal", normal)}${table("K250", k250)}</div>`
        + `<p><strong>Total investment:</strong> ${vnd.format(normal.investment + k250.investment)} VND</p>`;
    } catch (error) {
      if (!bondQuote || !market || marketSymbol !== stockCode) {
        investorResults.textContent = "Select a valid bond and fetch stock history to calculate each investor.";
      }
      // Investment amounts remain useful before a market quote is fetched.
      if (Number.isFinite(purchasePrice) && purchasePrice > 0) {
        const normalShares = totalPurchaseShares(investors, "normal");
        const k250Shares = totalPurchaseShares(investors, "K250");
        results.textContent = `Normal: ${vnd.format(normalShares * purchasePrice)} VND · K250: ${vnd.format(k250Shares * purchasePrice)} VND · Total: ${vnd.format((normalShares + k250Shares) * purchasePrice)} VND. ${error.message}`;
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
      investors = parseInvestors(data);
      const inputRows = investors.map((investor, index) => `<tr><th scope="row">${escapeHtml(investor.name)}</th>`
        + `<td>${investor.regime}</td><td>${shares.format(investor.purchaseShares)}</td>`
        + `<td><label class="visually-hidden" for="investorHeldShares${index}">Shares held by ${escapeHtml(investor.name)}</label>`
        + `<input id="investorHeldShares${index}" type="number" min="0" step="1" inputmode="numeric" value="${investor.heldShares ?? ""}" /></td>`
        + `<td><label class="visually-hidden" for="investorHeldBonds${index}">Bonds held by ${escapeHtml(investor.name)}</label>`
        + `<input id="investorHeldBonds${index}" type="number" min="0" step="1" inputmode="numeric" value="${investor.heldBonds ?? ""}" /></td></tr>`).join("");
      investorInputs.innerHTML = investors.length
        ? `<div class="table-scroll"><table class="table"><thead><tr><th>Investor</th><th>Regime</th><th>Purchase shares</th><th>Shares held</th><th>Bonds held</th></tr></thead><tbody>${inputRows}</tbody></table></div>`
        : "No investors in funds.json.";
      investors.forEach((_, index) => {
        $(`investorHeldShares${index}`).addEventListener("input", render);
        $(`investorHeldBonds${index}`).addEventListener("input", render);
      });
      $("collateralFundsStatus").textContent = `${investors.length} investors · Normal: ${shares.format(totalPurchaseShares(investors, "normal"))} purchase shares · K250: ${shares.format(totalPurchaseShares(investors, "K250"))} purchase shares`;
      render();
    })
    .catch((error) => {
      $("collateralFundsStatus").textContent = `Could not load funds.json: ${error.message}`;
      results.textContent = "Fund quantities are unavailable.";
      investorInputs.textContent = "Investor records are unavailable.";
      investorResults.textContent = "Investor calculations are unavailable.";
    });
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
