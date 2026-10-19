Create another tab to monitor the following things

# Collateral monitor
The number of stocks:
- Normal regime
- K250

The total investment amount would be:
- input:
    Purchase price - numer: 13200

- output:
    normal: normal * purchase price
    k250: k250 * purchase price
    total: normal + k250

## Calculate the number of shares 
### The ratio box:
- input: 
    bond code - string: 
    stoc code - string: 
    normal: % of shares and % of bonds
    k250: % of shares and % of bonds

### Calculate the volume weighted average price of seleted shares
Actions: get the api from https://histdatafeed.vps.com.vn/tradingview/history?symbol=NAB&resolution=1D&from=1751673600&to=1792454400&countback=330, the data sample is 
-> NAB is the stock code
-> Resolution: 1D
-> to: if the current UTC + 7 is 3p.m -> return the to is the current timestamp or current date, else return the previous date
-> from: backward around 30 trading days (remember it is working days)
- output: volume weight average price 20

### Calculating the number of shares corresponding with each entities:
Calculate the secured obligation:
    Equal the investment amount above * 1.15^2

- input: 
    Evaluation date: 
- output:
    normal:
        number of shares: % of share*secured obligation / VWAP20 of the latest trading date of evaluation date -> roundup
        number of bonds: % of bonds * secured obligation / par + ai price (let look at /root/bond_price_calculation/js/priceTab.js for calculation of AI)
    k250: similar above but the % 

### Calculating CR
- input:
    Number of shares
    number of bonds

- output:
    the CR = (number of shares * VWAP20 + number of bonds * (par + ai) )/ secured obligation
