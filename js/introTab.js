import { parseDateVN, formatDateVN } from "../utils.js";
import { bondsData, bankRatesData } from "./dataLoader.js";

// Bond rates offered
const offeredRates = {
  corporate: {
    "1M": 4.7,
    "2M": 5.9,
    "3M": 6.2,
    "6M": 6.4,
    "1Y": 6.8,
  },
  bank: {
    "1M": 4.3,
    "2M": 5.2,
    "3M": 5.4,
    "6M": 5.7,
    "1Y": 5.9,
  },
};

// Duration mappings in months
const durationMonths = {
  "1M": 1,
  "2M": 2,
  "3M": 3,
  "6M": 6,
  "1Y": 12,
};

function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function subtractWorkingDays(dt, days) {
  let result = new Date(dt);
  let remaining = days;

  while (remaining > 0) {
    result.setDate(result.getDate() - 1);
    const dayOfWeek = result.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      remaining--;
    }
  }

  return result;
}

function buildSchedule(issue, maturity, freq) {
  const step = 12 / freq;
  let dates = [];
  let cur = new Date(issue);
  dates.push(cur);

  let i = 1;
  while (cur < maturity) {
    cur = new Date(issue);
    cur.setMonth(cur.getMonth() + i * step);

    // Adjust to next working day if weekend
    const dayOfWeek = cur.getDay();
    if (dayOfWeek === 0) {
      cur.setDate(cur.getDate() + 1);
    } else if (dayOfWeek === 6) {
      cur.setDate(cur.getDate() + 2);
    }

    dates.push(new Date(cur));
    i++;
    if (cur > maturity) {
      dates[dates.length - 1] = maturity;
      break;
    }
  }

  return dates;
}

function findNextCoupon(bond, startDate) {
  const issue = parseDateVN(bond.issueDate);
  const maturity = parseDateVN(bond.maturity);
  const schedule = buildSchedule(issue, maturity, bond.frequency);

  for (let couponDate of schedule) {
    if (couponDate > startDate) {
      return couponDate;
    }
  }
  return null;
}

function getBondsForDuration(duration, selectedDate) {
  if (!bondsData || !bondsData.bonds) return [];

  const startDate = new Date(selectedDate);
  const endDate = addMonths(startDate, durationMonths[duration]);

  const suitableBonds = [];

  for (let bond of bondsData.bonds) {
    const issue = parseDateVN(bond.issueDate);
    const maturity = parseDateVN(bond.maturity);

    // Skip if bond has matured
    if (maturity <= startDate) continue;

    const schedule = buildSchedule(issue, maturity, bond.frequency);
    const recordingDays = bond.recordDays || 10;

    let hasCouponInPeriod = false;

    for (let couponDate of schedule) {
      // Check if coupon date falls within the period
      if (couponDate > startDate && couponDate <= endDate) {
        hasCouponInPeriod = true;
        break;
      }

      // Check if end date falls within recording period
      if (couponDate > endDate) {
        const recordingStartDate = subtractWorkingDays(couponDate, recordingDays);
        if (endDate >= recordingStartDate && endDate < couponDate) {
          hasCouponInPeriod = true;
          break;
        }
      }
    }

    // For 1M and 2M, we want bonds with NO coupon in the period
    if ((duration === "1M" || duration === "2M") && !hasCouponInPeriod) {
      const nextCoupon = findNextCoupon(bond, startDate);
      suitableBonds.push({
        code: bond.code,
        nextCoupon: nextCoupon,
        nextCouponFormatted: nextCoupon ? formatDateVN(nextCoupon) : "N/A",
      });
    }
    // For 3M, 6M, 1Y, we include all bonds
    else if (duration !== "1M" && duration !== "2M") {
      const nextCoupon = findNextCoupon(bond, startDate);
      suitableBonds.push({
        code: bond.code,
        nextCoupon: nextCoupon,
        nextCouponFormatted: nextCoupon ? formatDateVN(nextCoupon) : "N/A",
        hasCoupon: hasCouponInPeriod,
      });
    }
  }

  // Sort by next coupon date (descending)
  suitableBonds.sort((a, b) => {
    if (!a.nextCoupon) return 1;
    if (!b.nextCoupon) return -1;
    return b.nextCoupon - a.nextCoupon;
  });

  return suitableBonds;
}

export function initIntroTab() {
  const selectedDateEl = document.getElementById("offeringDate");
  const ratesTableEl = document.getElementById("ratesTable");
  const offeringTableEl = document.getElementById("offeringTable");

  // Display rates table
  function displayRatesTable() {
    ratesTableEl.innerHTML = `
      <h3>Our Offered Rates</h3>
      <table class="table">
        <thead>
          <tr>
            <th>Bond Type</th>
            <th>1 Month</th>
            <th>2 Months</th>
            <th>3 Months</th>
            <th>6 Months</th>
            <th>1 Year</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Corporate Bond</strong></td>
            <td>${offeredRates.corporate["1M"]}%</td>
            <td>${offeredRates.corporate["2M"]}%</td>
            <td>${offeredRates.corporate["3M"]}%</td>
            <td>${offeredRates.corporate["6M"]}%</td>
            <td>${offeredRates.corporate["1Y"]}%</td>
          </tr>
          <tr>
            <td><strong>Bank Bond</strong></td>
            <td>${offeredRates.bank["1M"]}%</td>
            <td>${offeredRates.bank["2M"]}%</td>
            <td>${offeredRates.bank["3M"]}%</td>
            <td>${offeredRates.bank["6M"]}%</td>
            <td>${offeredRates.bank["1Y"]}%</td>
          </tr>
        </tbody>
      </table>
    `;
  }

  // Display offering bonds table
  function displayOfferingTable() {
    const selectedDate = parseDateVN(selectedDateEl.value);
    if (!selectedDate) {
      offeringTableEl.innerHTML =
        '<p class="muted">Please select a date to view available bonds.</p>';
      return;
    }

    const durations = ["1M", "2M", "3M", "6M", "1Y"];
    const bondsByDuration = {};

    durations.forEach((duration) => {
      bondsByDuration[duration] = getBondsForDuration(duration, selectedDate);
    });

    // Find max rows needed
    const maxRows = Math.max(
      ...durations.map((d) => bondsByDuration[d].length)
    );

    let tableHTML = `
      <h3>Available Bonds by Duration</h3>
      <p class="muted">Selected Date: ${formatDateVN(selectedDate)}</p>
      <p class="muted" style="margin-top: 8px;">
        <strong>Note:</strong> For 1M and 2M durations, bonds listed will NOT have coupon payments during the period.
      </p>
      <table class="table">
        <thead>
          <tr>
            <th>1 Month</th>
            <th>2 Months</th>
            <th>3 Months</th>
            <th>6 Months</th>
            <th>1 Year</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (let i = 0; i < maxRows; i++) {
      tableHTML += "<tr>";
      durations.forEach((duration) => {
        const bonds = bondsByDuration[duration];
        if (i < bonds.length) {
          const bond = bonds[i];
          const endDate = addMonths(selectedDate, durationMonths[duration]);
          const recordingNote =
            bond.nextCoupon && bond.nextCoupon <= endDate
              ? '<br><small class="muted">(before recording)</small>'
              : "";
          tableHTML += `<td><strong>${bond.code}</strong><br><small class="muted">Next: ${bond.nextCouponFormatted}</small>${recordingNote}</td>`;
        } else {
          tableHTML += "<td>—</td>";
        }
      });
      tableHTML += "</tr>";
    }

    tableHTML += `
        </tbody>
      </table>
    `;

    offeringTableEl.innerHTML = tableHTML;
  }

  // Event listeners
  selectedDateEl.addEventListener("input", displayOfferingTable);

  // Initial display
  displayRatesTable();
  displayOfferingTable();
}