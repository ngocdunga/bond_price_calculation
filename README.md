# Bond and collateral calculators

This is a static website. To host it with GitHub Pages, push the repository and select **Settings → Pages → Build and deployment → Deploy from a branch**, then choose the branch and **/(root)**. `index.html`, `js/`, the CSS, and the JSON data files must stay together at the repository root. No build step or server API is required.

The [published GitHub Pages site](https://ngocdunga.github.io/bond_price_calculation/) shows local changes only after they are committed and pushed to the Pages branch.

## Investor records

`funds.json` contains an `investors` array. Add as many objects as needed; each object is one investor in one regime:

```json
{
  "name": "Investor A",
  "regime": "normal",
  "purchaseShares": 1000000,
  "heldShares": 500000,
  "heldBonds": 20000
}
```

Use `"normal"` or `"K250"` for `regime`. `purchaseShares` is the quantity used to calculate the investor's investment and secured obligation. `heldShares` and `heldBonds` are optional non-negative whole numbers used to calculate CR; set either to `null` when it is not known yet. The two existing rows in the file preserve the former Normal and K250 totals as placeholders. Replace or split those rows when adding actual investors to avoid counting their quantities twice. The page also lets you edit held quantities temporarily; edit `funds.json` to retain them.

The Collateral Monitor uses one purchase price, stock code, bond code, and settlement date for all investors. The bond choices come from `bonds.json`. A [complete NAB market data request](https://histdatafeed.vps.com.vn/tradingview/history?symbol=NAB&resolution=1D&from=1790000000&to=1792454400&countback=30) returns JSON; the bare endpoint URL requires query parameters. The market endpoint currently permits browser requests from GitHub Pages.

## Calculations

VWAP20 here is the volume weighted average of daily closing prices over the latest 20 valid sessions, rounded down to the nearest whole VND before use. The table shows all 20 closes, volumes, volume weights, the unrounded average, and the price used. VPS quotes are treated as thousands of VND per share.

For each investor, `investment = purchaseShares × purchase price`, `secured obligation = investment × 1.15²`, and `required collateral = secured obligation × minimum CR / 100`. Required shares are `ceil(share allocation / rounded-down VWAP20)`; required bonds are `ceil(bond allocation / (par + accrued interest))`. Accrued interest uses the same coupon schedule, bank rates, settlement date, and recording period rule as the Price Calculator. Minimum CR defaults to 50%; the default allocation is 40% shares and 60% bonds for both regimes. Regime totals add the individually rounded investor quantities.

For held collateral, each investor's `CR = (heldShares × rounded-down VWAP20 + heldBonds × (par + accrued interest)) / secured obligation × 100%`. Normal, K250, and combined CR totals appear only when every investor in the respective group has both held quantities entered.
