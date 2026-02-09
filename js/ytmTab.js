import {
  vndInt,
  vnd6,
  formatVNDInput,
  parseVNDInput,
  parseDateVN,
  formatDateVN,
  calculateAverageBankRate,
  calculateYTM,
} from "../utils.js";

import { bondsData, bankRatesData } from "./dataLoader.js";
import { updateBondInfo } from "./priceTab.js";

let selectedBondYTM = null;

export function initYTMTab() {
  const bondSelectYTMEl = document.getElementById("bondSelectYTM");
  const bondInfoYTMEl = document.getElementById("bondInfoYTM");
  const bankRateInfoYTMEl = document.getElementById("bankRateInfoYTM");
  const recordingWarningYTMEl = document.getElementById("recordingWarningYTM");
  const fvYTMEl = document.getElementById("fvYTM");
  const priceEl = document.getElementById("price");
  const settleYTMEl = document.getElementById("settleYTM");
  const outYTM = document.getElementById("outYTM");
  const cfsYTM = document.getElementById("cfsYTM");
  const ytmStatusEl = document.getElementById("ytmStatus");

  function onBondSelectYTM() {
    const bondCode = bondSelectYTMEl.value;

    if (!bondCode) {
      selectedBondYTM = null;
      bondInfoYTMEl.classList.add("hidden");
      bankRateInfoYTMEl.classList.add("hidden");
      recordingWarningYTMEl.classList.add("hidden");
      return;
    }

    selectedBondYTM = bondsData.bonds.find((b) => b.code === bondCode);
    if (!selectedBondYTM) return;

    fvYTMEl.value = formatVNDInput(selectedBondYTM.faceValue.toString());

    updateBondInfo(selectedBondYTM, bondInfoYTMEl, bankRateInfoYTMEl);
    recalcYTM();
  }

  function recalcYTM() {
    if (!selectedBondYTM) return;

    const fv = parseVNDInput(fvYTMEl.value);
    const targetPrice = parseVNDInput(priceEl.value);

    if (!fv || !targetPrice) return;

    const settle = parseDateVN(settleYTMEl.value);
    const issue = parseDateVN(selectedBondYTM.issueDate);
    const maturity = parseDateVN(selectedBondYTM.maturity);

    if (!issue || !settle || !maturity) {
      outYTM.textContent = "Invalid date format (DD/MM/YYYY)";
      recordingWarningYTMEl.classList.add("hidden");
      return;
    }

    const baseBankRate = calculateAverageBankRate(
      selectedBondYTM.referenceBank,
      bankRatesData.rates
    );

    const recordingDays = selectedBondYTM.recordDays || 10;

    ytmStatusEl.innerHTML = '<div class="muted">Calculating YTM...</div>';
    ytmStatusEl.classList.remove("hidden");

    const result = calculateYTM({
      fv,
      targetPrice,
      freq: selectedBondYTM.frequency,
      issue,
      settle,
      maturity,
      interestSchedule: selectedBondYTM.interestSchedule,
      baseBankRate,
      recordingDays,
      regime: selectedBondYTM.regime
    });

    if (result.success) {
      ytmStatusEl.innerHTML = `<div class="success">✓ Converged in ${result.iterations} iterations (precision: ${result.precision.toExponential(2)})</div>`;

      const r = result.bondData;

      if (r.inRecordingPeriod) {
        recordingWarningYTMEl.innerHTML = `
          RECORDING PERIOD ALERT: Settlement date is within the recording period for upcoming coupon payment on ${formatDateVN(r.upcomingCouponDate)}. 
          Recording started on ${formatDateVN(r.recordingStartDate)}. This coupon has been excluded from the bond price calculation.
        `;
        recordingWarningYTMEl.classList.remove("hidden");
      } else {
        recordingWarningYTMEl.classList.add("hidden");
      }

      cfsYTM.innerHTML = r.cfs.length
        ? `
<table class="table">
  <thead>
    <tr>
      <th>Date</th>
      <th>#</th>
      <th>Rate</th>
      <th>Cash Flow</th>
      <th>PV</th>
    </tr>
  </thead>
  <tbody>
    ${r.cfs
      .map(
        (x) => `
      <tr${x.skipped ? ' class="skipped-row"' : ""}>
        <td>${x.date}${x.skipped ? " (SKIPPED)" : ""}</td>
        <td>${x.paymentNum}</td>
        <td>${x.skipped ? "—" : (x.rate * 100).toFixed(3) + "%"}</td>
        <td>${x.skipped ? "—" : vnd6.format(x.cf)}</td>
        <td>${x.skipped ? "—" : vnd6.format(x.pv)}</td>
      </tr>
    `
      )
      .join("")}
  </tbody>
</table>
`
        : "—";

      outYTM.innerHTML = `
<table class="table">
  <tbody>
    <tr>
      <th>Yield to Maturity (YTM)</th>
      <td><strong>${result.ytm.toFixed(4)}%</strong></td>
    </tr>
    <tr>
      <th>Prev coupon</th>
      <td>${r.prev ? formatDateVN(r.prev) : "—"}</td>
    </tr>
    <tr>
      <th>Next coupon</th>
      <td>${r.next ? formatDateVN(r.next) : "—"}</td>
    </tr>
    <tr>
      <th>Accrued interest</th>
      <td>${vndInt.format(r.accrued)}</td>
    </tr>
    <tr>
      <th>Target price</th>
      <td>${vndInt.format(targetPrice)}</td>
    </tr>
    <tr>
      <th>Calculated price</th>
      <td>${vndInt.format(r.dirty)}</td>
    </tr>
    <tr>
      <th>Price difference</th>
      <td>${vndInt.format(Math.abs(r.dirty - targetPrice))}</td>
    </tr>
  </tbody>
</table>
`;
    } else {
      ytmStatusEl.innerHTML = `<div class="warning">⚠ ${result.message}</div>`;
      outYTM.textContent = "Unable to calculate YTM. Please check inputs.";
      cfsYTM.innerHTML = "—";
      recordingWarningYTMEl.classList.add("hidden");
    }
  }

  bondSelectYTMEl.addEventListener("change", onBondSelectYTM);
  fvYTMEl.addEventListener("input", () => {
    const pos = fvYTMEl.selectionStart;
    const before = fvYTMEl.value;
    fvYTMEl.value = formatVNDInput(before);
    const diff = fvYTMEl.value.length - before.length;
    fvYTMEl.setSelectionRange(pos + diff, pos + diff);
    recalcYTM();
  });
  priceEl.addEventListener("input", () => {
    const pos = priceEl.selectionStart;
    const before = priceEl.value;
    priceEl.value = formatVNDInput(before);
    const diff = priceEl.value.length - before.length;
    priceEl.setSelectionRange(pos + diff, pos + diff);
    recalcYTM();
  });
  settleYTMEl.addEventListener("input", recalcYTM);
}