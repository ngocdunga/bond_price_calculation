import { vacationDates } from "./js/dataLoader.js";
// ================= FORMATTERS =================
// VND – no decimals
export const vndInt = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

// VND – 6 decimals
export const vnd6 = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  minimumFractionDigits: 6,
  maximumFractionDigits: 6,
});

// ================= FACE VALUE INPUT =================

export function formatVNDInput(value) {
  const digits = value.replace(/\D/g, "");
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function parseVNDInput(value) {
  return Number(value.replace(/[.,]/g, ""));
}

// ================= DATE PARSER (DD/MM/YYYY) =================

export function parseDateVN(str) {
  if (!str) return null;

  // DD/MM/YYYY
  if (str.includes("/")) {
    const [d, m, y] = str.split("/").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  // YYYY-MM-DD (fallback)
  if (str.includes("-")) {
    const [y, m, d] = str.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  return null;
}

export function formatDateVN(dt) {
  const d = String(dt.getUTCDate()).padStart(2, "0");
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const y = dt.getUTCFullYear();
  return `${d}/${m}/${y}`;
}

// ================= DATE MATH =================

function addMonthsUTC(dt, months) {
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth();
  const d = dt.getUTCDate();
  const tmp = new Date(Date.UTC(y, m + months, 1));
  const last = new Date(
    Date.UTC(tmp.getUTCFullYear(), tmp.getUTCMonth() + 1, 0),
  ).getUTCDate();
  let result = new Date(
    Date.UTC(tmp.getUTCFullYear(), tmp.getUTCMonth(), Math.min(d, last)),
  );

  return result;
}

function subtractWorkingDays(dt, days, vacationData) {
  let result = new Date(dt);
  let remaining = days;

  // Build holiday set inside this function
  const holidaySet = new Set();

  Object.entries(vacationData).forEach(([startStr, info]) => {
    const startDate = parseDateVN(startStr);
    const duration = info.Last || 1;

    for (let i = 0; i < duration; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      holidaySet.add(d.toDateString());
    }
  });

  // Subtract working days
  while (remaining > 0) {
    result.setDate(result.getDate() - 1);

    const day = result.getDay();
    const isWeekend = day === 0 || day === 6;
    const isHoliday = holidaySet.has(result.toDateString());

    if (!isWeekend && !isHoliday) {
      remaining--;
    }
  }

  return result;
}

function actualDays(d1, d2) {
  return Math.round((d2 - d1) / (24 * 60 * 60 * 1000));
}

function yearFrac(d1, d2) {
  return actualDays(d1, d2) / 365;
}

// Check if settlement date is in recording period
export function isInRecordingPeriod(
  settleDate,
  couponDate,
  recordingDays = 10,
) {
  const recordingStart = subtractWorkingDays(
    couponDate,
    recordingDays,
    vacationDates,
  );
  return settleDate >= recordingStart && settleDate < couponDate;
}

// ================= SCHEDULE =================

function buildSchedule(issue, maturity, freq, vacationData, regime = "NORMAL") {
  console.log("Building schedule with regime:", regime);
  const step = 12 / freq;
  let dates = [];
  let cur = new Date(issue); // Start from issue date
  dates.push(cur);

  let i = 1;
  while (cur < maturity) {
    cur = addMonthsUTC(new Date(issue), i * step);

    if (regime != "NORMAL") {
      const holidaySet = new Set();

      Object.entries(vacationData).forEach(([startStr, info]) => {
        const startDate = parseDateVN(startStr);
        const duration = info.Last || 1;

        for (let i = 0; i < duration; i++) {
          const d = new Date(startDate);
          d.setDate(d.getDate() + i);
          holidaySet.add(d.toDateString());
        }
      });
      // Adjust to next working day (Monday) if Saturday (6) or Sunday (0)
      const dayOfWeek = cur.getUTCDay();
      if (dayOfWeek === 0) {
        // Sunday → next Monday
        cur = new Date(
          Date.UTC(
            cur.getUTCFullYear(),
            cur.getUTCMonth(),
            cur.getUTCDate() + 1,
          ),
        );
      } else if (dayOfWeek === 6) {
        // Saturday → next Monday
        cur = new Date(
          Date.UTC(
            cur.getUTCFullYear(),
            cur.getUTCMonth(),
            cur.getUTCDate() + 2,
          ),
        );
      } else if (holidaySet.has(cur.toDateString())) {
        // If the current date is a holiday, move to the next working day
        cur = new Date(
          Date.UTC(
            cur.getUTCFullYear(),
            cur.getUTCMonth(),
            cur.getUTCDate() + 1,
          ),
        );
        // Keep moving forward until we find a non-holiday working day
        while (holidaySet.has(cur.toDateString())) {
          cur = new Date(
            Date.UTC(
              cur.getUTCFullYear(),
              cur.getUTCMonth(),
              cur.getUTCDate() + 1,
            ),
          );
        }
      }
    }
    dates.push(cur);
    i++;
    // If we overshoot maturity, stop
    if (cur > maturity) {
      dates[dates.length - 1] = maturity; // Set last date to maturity
      break;
    }
  }

  return dates;
}

function findPrevNext(schedule, settle) {
  let i = 0;
  let prev = null,
    next = null;
  for (let d of schedule) {
    i++;
    if (d <= settle) prev = d;
    if (d > settle && !next) next = d;
  }
  return { prev, next };
}

// ================= FLOATING RATE HELPERS =================

export function getPaymentNumber(schedule, payDate) {
  let count = 0;
  for (let d of schedule) {
    if (+d === +payDate) return count;
    count++;
  }
  return count;
}

export function getInterestRate(interestSchedule, paymentNum) {
  // Find the rate for this payment number
  for (let i = interestSchedule.length - 1; i >= 0; i--) {
    if (paymentNum >= interestSchedule[i].payment) {
      return interestSchedule[i];
    }
  }
  // Default to first rate if payment number is before first defined payment
  return interestSchedule[0] || { rate: 0, payment: 0, isFloat: false };
}

export function calculateAverageBankRate(referenceBank, bankRates) {
  if (!referenceBank || referenceBank.length === 0) return 0;

  let sum = 0;
  let count = 0;

  for (let bank of referenceBank) {
    if (bankRates[bank] !== undefined) {
      sum += bankRates[bank];
      count++;
    }
  }

  return count > 0 ? sum / count : 0;
}

// ================= PRICING (FLOATING RATE) =================

export function priceFloatingBond({
  fv,
  ytm,
  freq,
  issue,
  settle,
  maturity,
  interestSchedule,
  baseBankRate,
  recordingDays = 10,
  regime = "NORMAL",
}) {
  console.log("Pricing floating bond with base bank rate:", baseBankRate);
  const schedule = buildSchedule(issue, maturity, freq, vacationDates, regime);
  console.log("Payment schedule:", schedule);

  const { prev, next } = findPrevNext(schedule, settle);

  let accrued = 0;
  let inRecordingPeriod = false;
  let upcomingCouponDate = null;
  let recordingStartDate = null;

  // Check if we're in recording period for the next coupon
  if (next) {
    inRecordingPeriod = isInRecordingPeriod(settle, next, recordingDays);
    if (inRecordingPeriod) {
      upcomingCouponDate = next;
      recordingStartDate = subtractWorkingDays(
        next,
        recordingDays,
        vacationDates,
      );
    }
  }

  // If in recording period, don't calculate accrued interest
  if (!inRecordingPeriod && prev && settle >= prev) {
    const paymentNum = getPaymentNumber(schedule, prev);
    const scheduleRate = getInterestRate(interestSchedule, paymentNum);
    let effectiveRate =
      scheduleRate.rate + (scheduleRate.isFloat ? baseBankRate : 0);

    if (scheduleRate.floorRate && effectiveRate < scheduleRate.floorRate) {
      effectiveRate = scheduleRate.floorRate;
    }
    accrued = fv * effectiveRate * yearFrac(prev, settle);
  }

  let dirty = 0;
  let cfs = [];

  function df(payDate) {
    const yf = yearFrac(settle, payDate);
    const r = ytm / 100;
    return Math.pow(1 + r, -yf);
  }

  for (let i = 0; i < schedule.length; i++) {
    const payDate = schedule[i];
    if (payDate <= settle) continue;

    // Skip the next coupon if we're in its recording period
    if (inRecordingPeriod && +payDate === +next) {
      cfs.push({
        date: formatDateVN(payDate),
        yf: 0,
        cf: 0,
        pv: 0,
        rate: 0,
        paymentNum: getPaymentNumber(schedule, payDate),
        scheduleRate: 0,
        baseBankRate,
        skipped: true,
        reason: "In recording period",
      });
      continue;
    }

    const prevDate = schedule[i - 1] ?? issue;
    const yf = yearFrac(prevDate, payDate);

    // Get payment number and corresponding rate
    const paymentNum = getPaymentNumber(schedule, payDate);
    const scheduleRate = getInterestRate(interestSchedule, paymentNum);
    let effectiveRate =
      scheduleRate.rate + (scheduleRate.isFloat ? baseBankRate : 0);

    if (scheduleRate.floorRate && effectiveRate < scheduleRate.floorRate) {
      effectiveRate = scheduleRate.floorRate;
    }

    let cf = fv * effectiveRate * yf;
    if (+payDate === +maturity) cf += fv;

    const pv = cf * df(payDate);
    dirty += pv;
    // dirty = Math.round(Number(dirty.toFixed(6)));
    console.log(
      `CF on ${formatDateVN(payDate)}: cf=${cf}, pv=${pv}, dirty=${dirty}`,
    );
    cfs.push({
      date: formatDateVN(payDate),
      yf,
      cf,
      pv,
      rate: effectiveRate,
      paymentNum,
      scheduleRate: scheduleRate.rate,
      baseBankRate,
      skipped: false,
    });
  }

  return {
    dirty,
    clean: dirty - accrued,
    accrued,
    prev,
    next,
    cfs,
    inRecordingPeriod,
    upcomingCouponDate,
    recordingStartDate,
  };
}

// ================= YTM CALCULATION (NEWTON-RAPHSON) =================

export function calculateYTM({
  fv,
  targetPrice,
  freq,
  issue,
  settle,
  maturity,
  interestSchedule,
  baseBankRate,
  recordingDays = 10,
  initialGuess = 8, // Initial YTM guess in %
  tolerance = 0.0001, // Price difference tolerance in VND
  maxIterations = 100,
  regime = "NORMAL",
}) {
  let ytm = initialGuess;
  let iteration = 0;
  let priceDiff = Infinity;

  while (iteration < maxIterations && Math.abs(priceDiff) > tolerance) {
    // Calculate price at current YTM
    const result = priceFloatingBond({
      fv,
      ytm,
      freq,
      issue,
      settle,
      maturity,
      interestSchedule,
      baseBankRate,
      recordingDays,
      regime
    });

    priceDiff = result.dirty - targetPrice;

    // If close enough, return
    if (Math.abs(priceDiff) <= tolerance) {
      return {
        success: true,
        ytm,
        iterations: iteration,
        precision: Math.abs(priceDiff),
        bondData: result,
      };
    }

    // Calculate derivative (numerical approximation)
    const delta = 0.001; // Small change in YTM for derivative
    const resultUp = priceFloatingBond({
      fv,
      ytm: ytm + delta,
      freq,
      issue,
      settle,
      maturity,
      interestSchedule,
      baseBankRate,
      recordingDays,
      regime
    });

    const derivative = (resultUp.dirty - result.dirty) / delta;

    // Prevent division by zero
    if (Math.abs(derivative) < 1e-10) {
      return {
        success: false,
        message: `Convergence failed: derivative too small at iteration ${iteration}`,
        ytm,
        iterations: iteration,
      };
    }

    // Newton-Raphson update
    const ytmNew = ytm - priceDiff / derivative;

    // Prevent unrealistic YTM values
    if (ytmNew < -50 || ytmNew > 100) {
      return {
        success: false,
        message: `YTM out of reasonable range (${ytmNew.toFixed(2)}%) at iteration ${iteration}`,
        ytm,
        iterations: iteration,
      };
    }

    ytm = ytmNew;
    iteration++;
  }

  if (iteration >= maxIterations) {
    return {
      success: false,
      message: `Maximum iterations (${maxIterations}) reached. Last price difference: ${vndInt.format(Math.abs(priceDiff))}`,
      ytm,
      iterations: iteration,
    };
  }

  // Final calculation with converged YTM
  const finalResult = priceFloatingBond({
    fv,
    ytm,
    freq,
    issue,
    settle,
    maturity,
    interestSchedule,
    baseBankRate,
    recordingDays,
    regime
  });

  return {
    success: true,
    ytm,
    iterations: iteration,
    precision: Math.abs(finalResult.dirty - targetPrice),
    bondData: finalResult,
  };
}
// ================= TRANSACTION CALCULATION =================

export function calculateTransaction({
  numBonds,
  faceValue,
  paymentDateBuying,
  discountYield,
  paymentDateSelling,
  holdingRate,
  coverFees,
  isInstitution = false,
  transactionFeeRate = 0.001, // Default 0.1%, can be 0.015% for private bonds
  freq,
  issue,
  maturity,
  interestSchedule,
  baseBankRate,
  recordingDays = 10,
  regime = "NORMAL",
}) {
  // ========== LEG 1 (BUYING) ==========
  const leg1Bond = priceFloatingBond({
    fv: faceValue,
    ytm: discountYield,
    freq,
    issue,
    settle: paymentDateBuying,
    maturity,
    interestSchedule,
    baseBankRate,
    recordingDays,
    regime
  });

  const leg1PricePerBond = Math.round(leg1Bond.dirty + 0.5);
  const leg1SettlementAmount = leg1PricePerBond * numBonds;
  const leg1TransactionFee = leg1SettlementAmount * transactionFeeRate;
  const leg1TotalInvestment = leg1SettlementAmount + leg1TransactionFee;

  // ========== CALCULATE COUPONS RECEIVED ==========
  const schedule = buildSchedule(issue, maturity, freq, vacationDates, regime);
  let couponsReceived = 0;
  const couponFlows = []; // NEW: Track individual coupon payments
  const couponTaxRate = isInstitution ? 0 : 0.05;

  for (let i = 0; i < schedule.length; i++) {
    const couponDate = schedule[i];
    if (
      subtractWorkingDays(couponDate, recordingDays, vacationDates) >=
        paymentDateBuying &&
      subtractWorkingDays(couponDate, recordingDays, vacationDates) <
        paymentDateSelling
    ) {
      const prevDate = schedule[i - 1] ?? issue;
      const yf = yearFrac(prevDate, couponDate);

      const paymentNum = getPaymentNumber(schedule, couponDate);
      const scheduleRate = getInterestRate(interestSchedule, paymentNum);
      let effectiveRate =
        scheduleRate.rate + (scheduleRate.isFloat ? baseBankRate : 0);

      if (scheduleRate.floorRate && effectiveRate < scheduleRate.floorRate) {
        effectiveRate = scheduleRate.floorRate;
      }

      const grossCouponAmount = faceValue * effectiveRate * yf * numBonds;
      const couponTax = grossCouponAmount * couponTaxRate;
      const netCouponAmount = grossCouponAmount - couponTax;

      couponsReceived += grossCouponAmount;

      // NEW: Store coupon flow details
      couponFlows.push({
        date: couponDate,
        grossAmount: grossCouponAmount,
        tax: couponTax,
        netAmount: netCouponAmount,
      });
    }
  }

  const couponTax = couponsReceived * couponTaxRate;
  const netCoupons = couponsReceived - couponTax;

  // ========== CALCULATE TARGET AMOUNT ==========
  const daysHolding = actualDays(paymentDateBuying, paymentDateSelling);
  const targetAmount =
    leg1TotalInvestment * (1 + (holdingRate / 100) * (daysHolding / 365));

  // ========== LEG 2 (SELLING) ==========
  let leg2SettlementAmount;
  let leg2PricePerBond;
  let leg2TransactionFee;
  let leg2TransferTax;
  let leg2TransferFee;
  let leg2TotalReceived;

  if (coverFees) {
    const transferFee = Math.min(300000, numBonds * 0.3);
    leg2SettlementAmount = (targetAmount - netCoupons + transferFee) / 0.998;
    leg2PricePerBond = Math.round(leg2SettlementAmount / numBonds);
    leg2SettlementAmount = leg2PricePerBond * numBonds;

    leg2TransactionFee = leg2SettlementAmount * transactionFeeRate;
    leg2TransferTax = leg2SettlementAmount * 0.001;
    leg2TransferFee = transferFee;

    leg2TotalReceived =
      leg2SettlementAmount -
      leg2TransactionFee -
      leg2TransferTax -
      leg2TransferFee +
      netCoupons;
  } else {
    leg2SettlementAmount = targetAmount - netCoupons;
    leg2PricePerBond = leg2SettlementAmount / numBonds;

    leg2TransactionFee = leg2SettlementAmount * transactionFeeRate;
    leg2TransferTax = leg2SettlementAmount * 0.001;

    leg2TransferFee = Math.min(300000, numBonds * 0.3);

    leg2TotalReceived = leg2SettlementAmount + netCoupons;
  }

  // Calculate remaining YTM based on leg2 price
  const leg2YTMResult = calculateYTM({
    fv: faceValue,
    targetPrice: leg2PricePerBond,
    freq,
    issue,
    settle: paymentDateSelling,
    maturity,
    interestSchedule,
    baseBankRate,
    recordingDays,
    initialGuess: holdingRate,
    tolerance: 0.0001,
    maxIterations: 100,
    regime
  });

  // ========== PROFIT CALCULATION ==========
  const expectedInterest =
    leg1TotalInvestment * (holdingRate / 100) * (daysHolding / 365);

  let totalProfit;
  if (coverFees) {
    totalProfit = leg2TotalReceived - leg1TotalInvestment;
  } else {
    totalProfit =
      leg2TotalReceived -
      leg1TotalInvestment -
      leg2TransferFee -
      leg2TransferTax -
      leg2TransactionFee;
  }

  const annualizedReturn =
    (totalProfit / leg1TotalInvestment) * (365 / daysHolding) * 100;

  return {
    leg1: {
      pricePerBond: leg1PricePerBond,
      settlementAmount: leg1SettlementAmount,
      transactionFee: leg1TransactionFee,
      totalInvestment: leg1TotalInvestment,
      paymentDate: paymentDateBuying,
      inRecordingPeriod: leg1Bond.inRecordingPeriod,
      upcomingCouponDate: leg1Bond.upcomingCouponDate,
      recordingStartDate: leg1Bond.recordingStartDate,
    },
    leg2: {
      pricePerBond: leg2PricePerBond,
      settlementAmount: leg2SettlementAmount,
      transactionFee: leg2TransactionFee,
      transferTax: leg2TransferTax,
      transferFee: leg2TransferFee,
      totalReceived: leg2TotalReceived,
      paymentDate: paymentDateSelling,
      remainingYTM: leg2YTMResult.success ? leg2YTMResult.ytm : null,
      ytmCalculationSuccess: leg2YTMResult.success,
      ytmCalculationMessage: leg2YTMResult.success ? null : leg2YTMResult.message,
      inRecordingPeriod: leg2YTMResult.success ? leg2YTMResult.bondData.inRecordingPeriod : false,
      upcomingCouponDate: leg2YTMResult.success ? leg2YTMResult.bondData.upcomingCouponDate : null,
      recordingStartDate: leg2YTMResult.success ? leg2YTMResult.bondData.recordingStartDate : null,
    },
    profit: {
      daysHolding,
      expectedInterest,
      couponsReceived,
      couponTax,
      netCoupons,
      couponFlows,
      totalProfit,
      holdingInterestRate: annualizedReturn,
      targetAmount,
    },
  };
}