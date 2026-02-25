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
let txChart = null;

function initTransactionChart() {
  const canvas = document.getElementById("txChart");
  if (!canvas) {
    console.warn("Chart canvas not found, will initialize on first use");
    return;
  }

  // Destroy existing chart if it exists
  if (txChart) {
    txChart.destroy();
  }

  txChart = new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Principal (Investment)",
          data: [],
          borderColor: "#2196f3",
          backgroundColor: "rgba(33, 150, 243, 0.05)",
          tension: 0,
          fill: false,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 6,
          stepped: true,
          datalabels: {
            display: false,
          },
        },
        {
          label: "Accumulated Coupons",
          data: [],
          borderColor: "#ff9800",
          backgroundColor: "rgba(255, 152, 0, 0.05)",
          tension: 0,
          fill: false,
          borderWidth: 2.5,
          pointRadius: 6,
          pointHoverRadius: 8,
          pointStyle: 'circle',
          stepped: true,
          datalabels: {
            display: true,
            align: 'top',
            offset: 8,
            color: 'white',
            font: {
              weight: 'bold',
              size: 11,
            },
            formatter: function(value, context) {
              const index = context.dataIndex;
              const data = context.dataset.data;
              
              if (index > 0 && index < data.length - 1) {
                const prevValue = data[index - 1].y;
                const currValue = value.y;
                
                if (currValue > prevValue) {
                  const increment = currValue - prevValue;
                  return '+' + (increment / 1000000).toFixed(1) + 'M';
                }
              }
              return null;
            },
          },
        },
        {
          label: "Total Value (Principal + Coupons)",
          data: [],
          borderColor: "#4caf50",
          backgroundColor: "rgba(76, 175, 80, 0.1)",
          tension: 0,
          fill: true,
          borderWidth: 3,
          pointRadius: 0,
          pointHoverRadius: 6,
          stepped: true,
          datalabels: {
            display: true,
            align: function(context) {
              const index = context.dataIndex;
              const data = context.dataset.data;
              
              if (index === 0) return 'right';
              if (index === data.length - 1) return 'left';
              
              return 'top';
            },
            offset: 10,
            color: 'white',
            font: {
              weight: 'bold',
              size: 12,
            },
            formatter: function(value, context) {
              const index = context.dataIndex;
              const data = context.dataset.data;
              
              if (index === 0 || index === data.length - 1) {
                return (value.y / 1000000).toFixed(0) + 'M';
              }
              
              if (index > 0) {
                const prevValue = data[index - 1].y;
                const currValue = value.y;
                
                if (currValue > prevValue) {
                  return (currValue / 1000000).toFixed(1) + 'M';
                }
              }
              
              return null;
            },
          },
        },
      ],
    },
    plugins: [ChartDataLabels],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          display: true,
          position: "top",
          labels: {
            usePointStyle: true,
            padding: 15,
          },
        },
        tooltip: {
          callbacks: {
            label: function (context) {
              let label = context.dataset.label || "";
              if (label) {
                label += ": ";
              }
              label += vndInt.format(context.parsed.y);
              return label;
            },
            title: function (context) {
              const date = new Date(context[0].parsed.x);
              return formatDateVN(date);
            },
            afterBody: function(context) {
              const datasetIndex = context[0].datasetIndex;
              if (datasetIndex === 1) {
                const point = context[0];
                if (point.parsed.y > 0) {
                  return `Coupon Payment Event`;
                }
              }
              return '';
            },
          },
        },
        datalabels: {
          backgroundColor: function(context) {
            return context.dataset.borderColor;
          },
          borderRadius: 4,
          color: 'white',
          padding: {
            top: 4,
            bottom: 4,
            left: 6,
            right: 6,
          },
        },
      },
      scales: {
        x: {
          type: "time",
          time: {
            unit: "day",
            displayFormats: {
              day: "dd/MM/yyyy",
              month: "MM/yyyy",
              year: "yyyy",
            },
          },
          title: {
            display: true,
            text: "Date",
          },
        },
        y: {
          beginAtZero: true,
          ticks: {
            callback: (v) => {
              return (v / 1000000).toFixed(0) + 'M';
            },
          },
          title: {
            display: true,
            text: "Value (Million VND)",
          },
        },
      },
    },
  });

  console.log("Chart initialized successfully");
}

function updateTransactionChart(txResult) {
  if (!txChart) {
    console.log("Chart not initialized, initializing now...");
    initTransactionChart();
    
    if (!txChart) {
      console.warn("Cannot update chart - canvas not available");
      return;
    }
  }

  const principalSeries = [];
  const couponSeries = [];
  const totalValueSeries = [];

  const buyDate = txResult.leg1.paymentDate;
  const sellDate = txResult.leg2.paymentDate;
  const initialInvestment = txResult.leg1.totalInvestment;
  const finalReceived = txResult.leg2.totalReceived;

  const buyTime = buyDate.getTime();
  principalSeries.push({ x: buyTime, y: initialInvestment });
  couponSeries.push({ x: buyTime, y: 0 });
  totalValueSeries.push({ x: buyTime, y: initialInvestment });

  let accumulatedCoupons = 0;

  if (txResult.profit.couponFlows && txResult.profit.couponFlows.length > 0) {
    txResult.profit.couponFlows.forEach((coupon, index) => {
      const couponTime = coupon.date.getTime();
      
      principalSeries.push({ x: couponTime - 1, y: initialInvestment });
      couponSeries.push({ x: couponTime - 1, y: accumulatedCoupons });
      totalValueSeries.push({ x: couponTime - 1, y: initialInvestment + accumulatedCoupons });
      
      accumulatedCoupons += coupon.netAmount;
      
      principalSeries.push({ x: couponTime, y: initialInvestment });
      couponSeries.push({ x: couponTime, y: accumulatedCoupons });
      totalValueSeries.push({ x: couponTime, y: initialInvestment + accumulatedCoupons });
    });
  }

  const sellTime = sellDate.getTime();
  
  principalSeries.push({ x: sellTime - 1, y: initialInvestment });
  couponSeries.push({ x: sellTime - 1, y: accumulatedCoupons });
  totalValueSeries.push({ x: sellTime - 1, y: initialInvestment + accumulatedCoupons });
  
  principalSeries.push({ x: sellTime, y: 0 });
  couponSeries.push({ x: sellTime, y: accumulatedCoupons });
  totalValueSeries.push({ x: sellTime, y: finalReceived });

  console.log("Chart data points:", {
    principal: principalSeries.length,
    coupons: couponSeries.length,
    total: totalValueSeries.length,
    couponPayments: txResult.profit.couponFlows?.length || 0,
  });

  txChart.data.datasets[0].data = principalSeries;
  txChart.data.datasets[1].data = couponSeries;
  txChart.data.datasets[2].data = totalValueSeries;

  txChart.update('none');
}

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
  const institutionPurchaseEl = document.getElementById("institutionPurchase");
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
    if (!selectedBondTx) {
      outTx.textContent = "Please select a bond";
      profitTx.textContent = "—";
      recordingWarningTxEl.classList.add("hidden");
      return;
    }

    const numBonds = +numBondsEl.value;
    const faceValue = selectedBondTx.faceValue;

    const paymentDateBuying = parseDateVN(paymentDateBuyingEl.value);
    const discountYield = +discountYieldEl.value;

    const paymentDateSelling = parseDateVN(paymentDateSellingEl.value);
    const holdingRate = +holdingRateEl.value;

    const coverFees = coverFeesEl.checked;
    const isInstitution = institutionPurchaseEl.checked;

    const issue = parseDateVN(selectedBondTx.issueDate);
    const maturity = parseDateVN(selectedBondTx.maturity);

    if (!paymentDateBuying || !paymentDateSelling || !issue || !maturity) {
      outTx.textContent = "Invalid date format (DD/MM/YYYY)";
      profitTx.textContent = "—";
      recordingWarningTxEl.classList.add("hidden");
      return;
    }

    const baseBankRate = calculateAverageBankRate(
      selectedBondTx.referenceBank,
      bankRatesData.rates
    );

    const recordingDays = selectedBondTx.recordDays || 10;

    // Determine transaction fee rate based on bond listing
    const isPrivateBond = selectedBondTx.listing === "private";
    const transactionFeeRate = isPrivateBond ? 0.00015 : 0.001; // 0.015% for private, 0.1% for public
    const regime = selectedBondTx.regime;
    const txResult = calculateTransaction({
      numBonds,
      faceValue,
      paymentDateBuying,
      discountYield,
      paymentDateSelling,
      holdingRate,
      coverFees,
      isInstitution,
      transactionFeeRate,
      freq: selectedBondTx.frequency,
      issue,
      maturity,
      interestSchedule: selectedBondTx.interestSchedule,
      baseBankRate,
      recordingDays,
      regime
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

    const feeRateDisplay = (transactionFeeRate * 100).toFixed(3) + '%';
    const taxRateDisplay = isInstitution ? '0% (Institution - no withholding tax)' : '5%';

    let couponDetailsHTML = "";
    if (
      txResult.profit.couponFlows &&
      txResult.profit.couponFlows.length > 0
    ) {
      couponDetailsHTML = `
        <h4 style="margin-top: 16px">Coupon Payments During Holding Period</h4>
        <p class="muted">Bond Type: <strong>${isPrivateBond ? 'Private' : 'Public'}</strong> | Tax Rate: <strong>${taxRateDisplay}</strong></p>
        <table class="table">
          <thead>
            <tr>
              <th>Payment Date</th>
              <th>Gross Amount</th>
              <th>Tax ${isInstitution ? '(0%)' : '(5%)'}</th>
              <th>Net Amount</th>
              <th>Accumulated</th>
            </tr>
          </thead>
          <tbody>
            ${txResult.profit.couponFlows
              .reduce((html, coupon, index, arr) => {
                const accumulated = arr.slice(0, index + 1).reduce((sum, c) => sum + c.netAmount, 0);
                return html + `
              <tr>
                <td>${formatDateVN(coupon.date)}</td>
                <td>${vndInt.format(coupon.grossAmount)}</td>
                <td>${vndInt.format(coupon.tax)}</td>
                <td><strong>${vndInt.format(coupon.netAmount)}</strong></td>
                <td class="highlight-yellow">${vndInt.format(accumulated)}</td>
              </tr>
            `;
              }, '')}
          </tbody>
        </table>
      `;
    }

    outTx.innerHTML = `
<h4>Leg 1 - Purchasing Information</h4>
<p class="muted">Bond Listing: <strong>${isPrivateBond ? 'Private' : 'Public'}</strong> | Transaction Fee: <strong>${feeRateDisplay}</strong></p>
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
      <th>Transaction fee (${feeRateDisplay})</th>
      <td>${vndInt.format(txResult.leg1.transactionFee)}</td>
    </tr>
    <tr>
      <th>Total investment amount (B = A + F)</th>
      <td class="highlight-yellow"><strong>${vndInt.format(txResult.leg1.totalInvestment)}</strong></td>
    </tr>
  </tbody>
</table>

${couponDetailsHTML}

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
      <th>Expected settlement amount (G = P2 * N)</th>
      <td>${vndInt.format(txResult.leg2.settlementAmount)}</td>
    </tr>
    <tr>
      <th>Expected transaction fee (${feeRateDisplay})</th>
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
      <th>Expected coupons received (${txResult.profit.couponFlows?.length || 0} payments)</th>
      <td>${vndInt.format(txResult.profit.couponsReceived)}</td>
    </tr>
    <tr>
      <th>Coupon tax ${isInstitution ? '(0% - Institution)' : '(5%)'}</th>
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
    
    updateTransactionChart(txResult);
  }

  initTransactionChart();

  bondSelectTxEl.addEventListener("change", onBondSelectTx);
  numBondsEl.addEventListener("input", recalcTransaction);
  paymentDateBuyingEl.addEventListener("input", recalcTransaction);
  paymentDateBuyingEl.addEventListener("change", recalcTransaction);
  discountYieldEl.addEventListener("input", recalcTransaction);
  discountYieldEl.addEventListener("change", recalcTransaction);
  paymentDateSellingEl.addEventListener("input", recalcTransaction);
  paymentDateSellingEl.addEventListener("change", recalcTransaction);
  holdingRateEl.addEventListener("input", recalcTransaction);
  holdingRateEl.addEventListener("change", recalcTransaction);
  coverFeesEl.addEventListener("change", recalcTransaction);
  institutionPurchaseEl.addEventListener("change", recalcTransaction);
}