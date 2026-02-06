export let bondsData = null;
export let bankRatesData = null;

export async function loadData() {
  try {
    const [bondsResponse, bankRatesResponse] = await Promise.all([
      fetch("./bonds.json"),
      fetch("./bankRates.json"),
    ]);

    bondsData = await bondsResponse.json();
    bankRatesData = await bankRatesResponse.json();

    return { bondsData, bankRatesData };
  } catch (error) {
    console.error("Error loading data:", error);
    throw error;
  }
}

export function populateBondSelect(selectId, bonds) {
  const select = document.getElementById(selectId);
  bonds.forEach((bond) => {
    const option = document.createElement("option");
    option.value = bond.code;
    option.textContent = bond.code;
    select.appendChild(option);
  });
}

export function setTodaySettlement(...elementIds) {
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, "0");
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const yyyy = today.getFullYear();
  const dateStr = `${dd}/${mm}/${yyyy}`;
  
  elementIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = dateStr;
  });
}