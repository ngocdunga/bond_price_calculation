// ================= FORMATTERS =================

// VND – no decimals
export const vndInt = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0
});

// VND – 6 decimals
export const vnd6 = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  minimumFractionDigits: 6,
  maximumFractionDigits: 6
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
  const last = new Date(Date.UTC(tmp.getUTCFullYear(), tmp.getUTCMonth() + 1, 0)).getUTCDate();
  let result = new Date(Date.UTC(tmp.getUTCFullYear(), tmp.getUTCMonth(), Math.min(d, last)));
  
  // Adjust to next working day (Monday) if Saturday (6) or Sunday (0)
  const dayOfWeek = result.getUTCDay();
  if (dayOfWeek === 0) { // Sunday → next Monday
    result = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth(), result.getUTCDate() + 1));
  } else if (dayOfWeek === 6) { // Saturday → next Monday  
    result = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth(), result.getUTCDate() + 2));
  }
  
  return result;
}

function actualDays(d1, d2) {
  return Math.round((d2 - d1) / (24 * 60 * 60 * 1000));
}

function yearFrac(d1, d2) {
  return actualDays(d1, d2) / 365;
}

// ================= SCHEDULE =================

function buildSchedule(issue, maturity, freq) {
  const step = 12 / freq;
  let dates = [];
  let cur = new Date(issue); // Start from issue date
  dates.push(cur);

  let i = 1;
  while (cur < maturity) {
    cur = addMonthsUTC(new Date(issue), i*step);
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
  let prev = null, next = null;
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
      return  interestSchedule[i];
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

// ================= PRICING (FIXED RATE) =================

export function priceBond({ fv, coupon, ytm, freq, issue, settle, maturity }) {
  const schedule = buildSchedule(issue, maturity, freq);
  const { prev, next } = findPrevNext(schedule, settle);

  let accrued = 0;
  if (prev && settle >= prev) {
    accrued = fv * (coupon / 100) * yearFrac(prev, settle);
  }

  let dirty = 0;
  let cfs = [];

  function df(payDate) {
    const yf = yearFrac(settle, payDate);
    const r = (ytm / 100) / freq;
    return Math.pow(1 + r, -freq * yf);
  }

  for (let i = 0; i < schedule.length; i++) {
    const payDate = schedule[i];
    if (payDate <= settle) continue;

    const prevDate = schedule[i - 1] ?? issue;
    const yf = yearFrac(prevDate, payDate);
    let cf = fv * (coupon / 100) * yf;

    if (+payDate === +maturity) cf += fv;

    const pv = cf * df(payDate);
    dirty += pv;

    cfs.push({ date: formatDateVN(payDate), yf, cf, pv, rate: coupon / 100 });
  }

  return { dirty, clean: dirty - accrued, accrued, prev, next, cfs };
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
  baseBankRate 
}) {
  const schedule = buildSchedule(issue, maturity, freq);
  const { prev, next } = findPrevNext(schedule, settle);

  let accrued = 0;
  if (prev && settle >= prev) {
    const paymentNum = getPaymentNumber(schedule, prev);
    const scheduleRate = getInterestRate(interestSchedule, paymentNum);
    let effectiveRate = scheduleRate.rate + (scheduleRate.isFloat ? baseBankRate : 0);

    if (scheduleRate.floorRate && effectiveRate < scheduleRate.floorRate) {
      effectiveRate = scheduleRate.floorRate;
    }

    accrued = fv * effectiveRate * yearFrac(prev, settle);
  }

  let dirty = 0;
  let cfs = [];

  function df(payDate) {
    const yf = yearFrac(settle, payDate);
    const r = (ytm / 100);
    return Math.pow(1 + r, -yf);
  }

  for (let i = 0; i < schedule.length; i++) {
    const payDate = schedule[i];
    if (payDate <= settle) continue;

    const prevDate = schedule[i - 1] ?? issue;
    const yf = yearFrac(prevDate, payDate);
    
    // Get payment number and corresponding rate
    const paymentNum = getPaymentNumber(schedule, payDate);
    const scheduleRate = getInterestRate(interestSchedule, paymentNum);
    let effectiveRate = scheduleRate.rate + (scheduleRate.isFloat ? baseBankRate : 0);

    if (scheduleRate.floorRate && effectiveRate < scheduleRate.floorRate) {
      effectiveRate = scheduleRate.floorRate;
    }

    let cf = fv * effectiveRate * yf;
    if (+payDate === +maturity) cf += fv;

    const pv = cf * df(payDate);
    dirty += pv;

    cfs.push({ 
      date: formatDateVN(payDate), 
      yf, 
      cf, 
      pv, 
      rate: effectiveRate,
      paymentNum,
      scheduleRate: scheduleRate.rate,
      baseBankRate
    });
  }

  return { dirty, clean: dirty - accrued, accrued, prev, next, cfs };
}