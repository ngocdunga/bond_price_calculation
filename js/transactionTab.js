import {
  vndInt,
  parseDateVN,
  formatDateVN,
  calculateAverageBankRate,
  calculateTransaction,
} from "../utils.js";

import { bondsData, bankRatesData } from "./dataLoader.js";
import { updateBondInfo } from "./priceTab.js";

let selectedBondTx = null;

export function initTransactionTab() {
  const bondSelectTxEl = document.getElementById("bondSelectTx");
  const bondInfoTxEl = document.getElementById("bondInfoTx");
  const bankRateInfoTxEl = document.getElementById("bankRateInfoTx");
  const recordingWarningTxEl = document.getElementById("recordingWarningTx");
  const numBondsEl = document.getElementById("numBonds");
  const paymentDateBuyingEl = document.getElementById("paymentDateBuying");
  const discountYieldEl = document.getElementById("discountYield");
  const paymentDateSellingEl = document.getElementById("paymentDateSelling");
  const holdingRateEl = document.getElementById("holdingRate");
  const coverFeesEl = document.getElementById("coverFees");
  const outTx = document.getElementById("outTx");
  const profitTx = document.getElementById("profitTx");

  function onBondSelectTx() {
    const bondCode = bondSelectTxEl.value;

    if (!bondCode) {
      selectedBondTx = null;
      bondInfoTxEl.classList.add("hidden");
      bankRateInfoTxEl.classList.add("hidden");
      recordingWarningTxEl.classList.add("hidden");
      return;
    }

    selectedBondTx = bondsData.bonds.find((b) => b.code === bondCode);
    if (!selectedBondTx) return;

    updateBondInfo(selectedBondTx, bondInfoTxEl, bankRateInfoTxEl);
    recalcTransaction();
  }

  function recalcTransaction() {
    if (!selectedBondTx) return;

    const numBonds = +numBondsEl.value;
    const faceValue = selectedBondTx.faceValue;

    const paymentDateBuying = parseDateVN(paymentDateBuyingEl.value);
    const discountYield = +discountYieldEl.value;

    const paymentDateSelling = parseDateVN(paymentDateSellingEl.value);
    const holdingRate = +holdingRateEl.value;

    const coverFees = coverFeesEl.checked;

    const issue = parseDateVN(selectedBondTx.issueDate);
    const maturity = parseDateVN(selectedBondTx.maturity);

    if (!paymentDateBuying || !paymentDateSelling || !issue || !maturity) {
      outTx.textContent = "Invalid date format (DD/MM/YYYY)";
      recordingWarningTxEl.classList.add("hidden");
      return;
    }

    const baseBankRate = calculateAverageBankRate(
      selectedBondTx.referenceBank,
      bankRatesData.rates
    );

    const recordingDays = selectedBondTx.recordDays || 10;

    const txResult = calculateTransaction({
      numBonds,
      faceValue,
      paymentDateBuying,
      discountYield,
      paymentDateSelling,
      holdingRate,
      coverFees,
      freq: selectedBondTx.frequency,
      issue,
      maturity,
      interestSchedule: selectedBondTx.interestSchedule,
      baseBankRate,
      recordingDays,
    });

    let warnings = [];
    if (txResult.leg1.inRecordingPeriod) {
      warnings.push(
        `LEG 1: Within recording period for coupon on ${formatDateVN(txResult.leg1.upcomingCouponDate)} (started ${formatDateVN(txResult.leg1.recordingStartDate)})`
      );
    }
    if (txResult.leg2.inRecordingPeriod) {
      warnings.push(
        `LEG 2: Within recording period for coupon on ${formatDateVN(txResult.leg2.upcomingCouponDate)} (started ${formatDateVN(txResult.leg2.recordingStartDate)})`
      );
    }

    if (warnings.length > 0) {
      recordingWarningTxEl.innerHTML = warnings.join("<br>");
      recordingWarningTxEl.classList.remove("hidden");
    } else {
      recordingWarningTxEl.classList.add("hidden");
    }

    outTx.innerHTML = `
<h4>Leg 1 - Purchasing Information</h4>
<table class="table">
  <tbody>
    <tr>
      <th>Payment date</th>
      <td>${formatDateVN(paymentDateBuying)}</td>
    </tr>
    <tr>
      <th>Discount yield</th>
      <td>${discountYield.toFixed(2)}%</td>
    </tr>
    <tr>
      <th>Purchasing price (per bond)</th>
      <td class="highlight-yellow">${vndInt.format(txResult.leg1.pricePerBond)}</td>
    </tr>
    <tr>
      <th>Settlement amount (A = P1 * N)</th>
      <td>${vndInt.format(txResult.leg1.settlementAmount)}</td>
    </tr>
    <tr>
      <th>Transaction fee (0.100%)</th>
      <td>${vndInt.format(txResult.leg1.transactionFee)}</td>
    </tr>
    <tr>
      <th>Total investment amount (B = A + F)</th>
      <td class="highlight-yellow"><strong>${vndInt.format(txResult.leg1.totalInvestment)}</strong></td>
    </tr>
  </tbody>
</table>

<h4 style="margin-top: 16px">Leg 2 - Expected Selling Information</h4>
<table class="table">
  <tbody>
    <tr>
      <th>Expected payment date</th>
      <td>${formatDateVN(paymentDateSelling)}</td>
    </tr>
    <tr>
      <th>Expected holding rate</th>
      <td>${holdingRate.toFixed(2)}%</td>
    </tr>
    <tr>
      <th>Target amount</th>
      <td>${vndInt.format(txResult.profit.targetAmount)}</td>
    </tr>
    <tr>
      <th>Expected selling price (per bond) ${coverFees ? "(adjusted for fees)" : ""}</th>
      <td class="highlight-yellow">${vndInt.format(txResult.leg2.pricePerBond)}</td>
    </tr>
    <tr>
      <th>Market price (for reference)</th>
      <td class="muted">${vndInt.format(txResult.leg2.marketPricePerBond)}</td>
    </tr>
    <tr>
      <th>Expected settlement amount (G = P2 * N)</th>
      <td>${vndInt.format(txResult.leg2.settlementAmount)}</td>
    </tr>
    <tr>
      <th>Expected transaction fee (0.100%)</th>
      <td>${vndInt.format(txResult.leg2.transactionFee)}</td>
    </tr>
    <tr>
      <th>Expected transfer tax (0.100%)</th>
      <td>${vndInt.format(txResult.leg2.transferTax)}</td>
    </tr>
    <tr>
      <th>Expected transfer fee</th>
      <td>${vndInt.format(txResult.leg2.transferFee)}</td>
    </tr>
    <tr>
      <th>Total expected received (H = G ${coverFees ? "- fees" : ""} + coupons)</th>
      <td class="highlight-yellow"><strong>${vndInt.format(txResult.leg2.totalReceived)}</strong></td>
    </tr>
  </tbody>
</table>
`;

    profitTx.innerHTML = `
<table class="table">
  <tbody>
    <tr>
      <th>Expected No. days holding (J = D2 - D1)</th>
      <td>${txResult.profit.daysHolding}</td>
    </tr>
    <tr>
      <th>Expected interest (K = B * R / 365 * J)</th>
      <td>${vndInt.format(txResult.profit.expectedInterest)}</td>
    </tr>
    <tr>
      <th>Expected coupons received</th>
      <td>${vndInt.format(txResult.profit.couponsReceived)}</td>
    </tr>
    <tr>
      <th>Coupon tax (5%)</th>
      <td>${vndInt.format(txResult.profit.couponTax)}</td>
    </tr>
    <tr>
      <th>Net coupons after tax</th>
      <td>${vndInt.format(txResult.profit.netCoupons)}</td>
    </tr>
    <tr>
      <th>Total profit</th>
      <td><strong>${vndInt.format(txResult.profit.totalProfit)}</strong></td>
    </tr>
    <tr>
      <th>Annualized holding interest rate (L = K / B * 365 / J)</th>
      <td><strong>${txResult.profit.holdingInterestRate.toFixed(3)}%</strong></td>
    </tr>
  </tbody>
</table>
`;
  }

  bondSelectTxEl.addEventListener("change", onBondSelectTx);
  [
    numBondsEl,
    paymentDateBuyingEl,
    discountYieldEl,
    paymentDateSellingEl,
    holdingRateEl,
    coverFeesEl,
  ].forEach((el) => el.addEventListener("input", recalcTransaction));
  coverFeesEl.addEventListener("change", recalcTransaction);
}