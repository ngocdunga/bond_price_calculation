import {
  vndInt,
  vnd6,
  formatVNDInput,
  parseVNDInput,
  parseDateVN,
  formatDateVN,
  priceFloatingBond,
  calculateAverageBankRate,
} from "../utils.js";

import { bondsData, bankRatesData } from "./dataLoader.js";

let selectedBond = null;

export function updateBondInfo(bond, infoEl, bankInfoEl) {
  let info = `<strong>${bond.code}</strong><br>`;
  info += `Frequency: ${bond.frequency}x per year<br>`;
  info += `Issue: ${bond.issueDate} | Maturity: ${bond.maturity}<br>`;
  info += `Recording Period: ${bond.recordDays || 10} working days`;
  info += `<br><strong>Interest Schedule:</strong><br>`;
  bond.interestSchedule.forEach((s) => {
    info += `Payment ${s.payment}: ADR + ${(s.rate * 100).toFixed(2)}%<br>`;
  });

  const avgRate = calculateAverageBankRate(
    bond.referenceBank,
    bankRatesData.rates
  );
  let bankInfo = `<strong>Reference Banks:</strong> ${bond.referenceBank.join(", ")}<br>`;
  bankInfo += `<strong>Average Deposit Rate (ADR):</strong> ${(avgRate * 100).toFixed(3)}%<br>`;
  bankInfo += `<strong>Individual Rates:</strong><br>`;
  bond.referenceBank.forEach((bank) => {
    bankInfo += `${bank}: ${(bankRatesData.rates[bank] * 100).toFixed(2)}%<br>`;
  });
  bankInfo += `<small>Last updated: ${bankRatesData.lastUpdated}</small>`;

  bankInfoEl.innerHTML = bankInfo;
  bankInfoEl.classList.remove("hidden");
  infoEl.innerHTML = info;
  infoEl.classList.remove("hidden");
}

export function initPriceTab() {
  const bondSelectEl = document.getElementById("bondSelect");
  const bondInfoEl = document.getElementById("bondInfo");
  const bankRateInfoEl = document.getElementById("bankRateInfo");
  const recordingWarningEl = document.getElementById("recordingWarning");
  const fvEl = document.getElementById("fv");
  const yEl = document.getElementById("yield");
  const settleEl = document.getElementById("settle");
  const out = document.getElementById("out");
  const cfs = document.getElementById("cfs");

  function onBondSelect() {
    const bondCode = bondSelectEl.value;

    if (!bondCode) {
      selectedBond = null;
      bondInfoEl.classList.add("hidden");
      bankRateInfoEl.classList.add("hidden");
      recordingWarningEl.classList.add("hidden");
      return;
    }

    selectedBond = bondsData.bonds.find((b) => b.code === bondCode);
    if (!selectedBond) return;

    fvEl.value = formatVNDInput(selectedBond.faceValue.toString());

    updateBondInfo(selectedBond, bondInfoEl, bankRateInfoEl);
    recalc();
  }

  function recalc() {
    if (!selectedBond) return;

    const fv = parseVNDInput(fvEl.value);
    if (!fv) return;

    const y = +yEl.value;
    const settle = parseDateVN(settleEl.value);
    const issue = parseDateVN(selectedBond.issueDate);
    const maturity = parseDateVN(selectedBond.maturity);

    if (!issue || !settle || !maturity) {
      out.textContent = "Invalid date format (DD/MM/YYYY)";
      recordingWarningEl.classList.add("hidden");
      return;
    }

    const baseBankRate = calculateAverageBankRate(
      selectedBond.referenceBank,
      bankRatesData.rates
    );

    const recordingDays = selectedBond.recordDays || 10;

    console.log("Bond regime:", selectedBond.regime);
    const r = priceFloatingBond({
      fv,
      ytm: y,
      freq: selectedBond.frequency,
      issue,
      settle,
      maturity,
      interestSchedule: selectedBond.interestSchedule,
      baseBankRate,
      recordingDays,
      regime: selectedBond.regime
    });

    if (r.inRecordingPeriod) {
      recordingWarningEl.innerHTML = `
        RECORDING PERIOD ALERT: Settlement date is within the recording period for upcoming coupon payment on ${formatDateVN(r.upcomingCouponDate)}. 
        Recording started on ${formatDateVN(r.recordingStartDate)}. This coupon will be excluded from the bond price.
      `;
      recordingWarningEl.classList.remove("hidden");
    } else {
      recordingWarningEl.classList.add("hidden");
    }

    cfs.innerHTML = r.cfs.length
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

    out.innerHTML = `
<table class="table">
  <tbody>
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
      <th>Dirty price</th>
      <td><strong>${vndInt.format(r.dirty)}</strong></td>
    </tr>
  </tbody>
</table>
`;
  }

  bondSelectEl.addEventListener("change", onBondSelect);
  fvEl.addEventListener("input", () => {
    const pos = fvEl.selectionStart;
    const before = fvEl.value;
    fvEl.value = formatVNDInput(before);
    const diff = fvEl.value.length - before.length;
    fvEl.setSelectionRange(pos + diff, pos + diff);
    recalc();
  });
  [yEl, settleEl].forEach((el) => el.addEventListener("input", recalc));
}