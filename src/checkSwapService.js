// @flow
const fs = require('fs')
const js = require('jsonfile')
const fetch = require('node-fetch')
const { bns } = require('biggystring')
const confFileName = './config.json'
const config = js.readFileSync(confFileName)
const jsonFormat = require('json-format')

export type TxData = {
  txCount: number,
  // avgBtc: string,
  // avgUsd: string,
  currencyAmount: { [currencyCode: string]: string },
  amountBtc: string,
  amountUsd: string,
}

export type TxDataMap = { [currencyCode: string]: TxData }

export type ShapeShiftTx = {
  inputTXID: string,
  inputAddress: string,
  inputCurrency: string,
  inputAmount: number,
  outputAddress: string,
  outputCurrency: string,
  status: string, // complete,
  timestamp: number,
  outputAmount: string
}

export type SwapFuncParams = {
  useCache: boolean,
  interval: string,
  endDate: string
}

let _coincapQuery

const jsonConfig = {
  type: 'space',
  size: 2
}

function pad (num, size) {
  let s = num + ''
  while (s.length < size) {
    s = '0' + s
  }
  return s
}

function padRight (num, size) {
  let s = num + ''
  while (s.length < size) {
    s = s + '0'
  }
  return s
}

let ratePairs: { [date: string]: { [code: string]: string } } = {}
let ratesLoaded = false
let btcRates = {}
let btcRatesLoaded = false

type GetRateOptions = {
  from: string,
  to: string,
  year: string,
  month: string,
  day: string
}

function clearCache () {
  ratePairs = {}
  ratesLoaded = false
  btcRates = {}
  btcRatesLoaded = false
}

// only queries altcoin to USD
async function queryCoinApi (currencyCode: string, date: string) {
  // const url = `https://rest.coinapi.io/v1/exchangerate/${currencyCode}/USD?time=2017-08-09T12:00:00.0000000Z`
  const url = `https://rest.coinapi.io/v1/exchangerate/${currencyCode}/USD?time=${date}T00:00:00.0000000Z&apiKey=${config.coinApiKey}`
  // const url = `https://rest.coinapi.io/v1/exchangerate/${currencyCode}/USD`
  //   if (!doSummary) {
  //     console.log(url)
  //   }
  // console.log('kylan fetched url is: ', url)
  let response
  try {
    response = await fetch(url, {
      method: 'GET'
    })
    const jsonObj = await response.json()
    if (!jsonObj.rate) {
      throw new Error('No rate from CoinAPI')
    }
    return jsonObj.rate.toString()
  } catch (e) {
    // if (!doSummary) {
    console.log(e)
    // }
    throw e
  }
}

// {
//   "time": "2019-04-26T23:59:59.6886775Z",
//   "asset_id_base": "BTC",
//   "asset_id_quote": "USD",
//   "rate": 5242.7856103737234839148323278
// }

// only queries altcoin to USD
async function queryCoinMarketCap (currencyCode: string, date: string) {
  const url = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/historical?symbol=${currencyCode}&time_end=${date}&count=1`

  let response
  const fetchOptions = {
    method: 'GET',
    headers: {
      'X-CMC_PRO_API_KEY': config.coinMarketCapAPiKey
    },
    json: true
  }
  // console.log('fetchOptions: ', fetchOptions)
  try {
    response = await fetch(url, fetchOptions)
    const jsonObj = await response.json()
    if (!jsonObj || !jsonObj.data || !jsonObj.data.quotes || !jsonObj.data.quotes[0] || !jsonObj.data.quotes[0].quote || !jsonObj.data.quotes[0].quote.USD) {
      throw new Error('No rate from CMC')
    }
    return jsonObj.data.quotes[0].quote.USD.price.toString()
  } catch (e) {
    // if (!doSummary) {
    console.log('No CoinMarketCap quote: ', e)
    // }
    throw e
  }
}

async function getPairCached (currencyCode: string, date: string) {
  // if the prices have NOT been loaded
  if (!ratesLoaded) {
    try {
      // grab them from the persistent cache
      ratePairs = js.readFileSync('./cache/ratePairs.json')
    } catch (e) {
      console.log(e)
    }
  }
  ratesLoaded = true

  let rate
  // if the currency has a pair for the date
  if (ratePairs[date] && ratePairs[date][currencyCode]) {
    rate = ratePairs[date][currencyCode]
  } else {
    // if the date does not exist or does not have a currency rate
    if (!ratePairs[date]) {
      ratePairs[date] = {} // initialize the date
    }
    const currentTimestamp = Date.now()
    const targetDate = new Date(date)
    const targetTimestamp = targetDate.getTime()
    // if less than 90 days old (cmc API restriction)
    if (currentTimestamp - targetTimestamp < 89 * 86400 * 1000) {
      rate = await queryCoinMarketCap(currencyCode, date)
    }
    if (!rate) {
      // only query coinApi if no rate loaded from cache or coinMarketCap
      rate = await queryCoinApi(currencyCode, date)
    }
    ratePairs[date][currencyCode] = rate
    js.writeFileSync('./cache/ratePairs.json', ratePairs)
  }
  return rate
}

// kylan - problematic routine, should be called "getHistoricalRate"?
async function getRate (opts: GetRateOptions): Promise<string> {
  const { from, to, year, month, day } = opts
  const date = `${year}-${month}-${day}`
  const pair = `${from}_${to}`

  let fromToUsd
  let toToUsd
  try {
    if (btcRates[pair]) {
      // these rates are not historical, only ad-hoc(?)
      throw new Error('blah')
    }
    fromToUsd = await getPairCached(from.toUpperCase(), date)
    toToUsd = await getPairCached(to.toUpperCase(), date)
    const finalRate = bns.div(fromToUsd, toToUsd, 8)
    return finalRate
  } catch (e) {
    try {
      if (!btcRatesLoaded) {
        // check btcRates
        try {
          btcRates = js.readFileSync('./cache/btcRates.json')
        } catch (e) {
          console.log(e)
        }
        btcRatesLoaded = true
      }
      if (btcRates[pair]) {
        return btcRates[pair]
      }

      if (!_coincapQuery) {
        const request = `https://coincap.io/front`
        const response = await fetch(request)
        _coincapQuery = await response.json()
      }
      for (const c of _coincapQuery) {
        if (c.short.toUpperCase() === from.toUpperCase()) {
          fromToUsd = c.price.toString()
        }
        if (c.short.toUpperCase() === to.toUpperCase()) {
          toToUsd = c.price.toString()
        }
        if (fromToUsd && toToUsd) {
          break
        }
      }
      if (fromToUsd && toToUsd) {
        const rate = bns.div(fromToUsd, toToUsd, 8)
        btcRates[pair] = rate
        js.writeFileSync('./cache/btcRates.json', btcRates)
        return rate
      }
      return '0'
    } catch (e) {
      throw e
    }
  }
}

async function checkSwapService (
  theFetch: Function,
  cacheFile: string,
  prefix: string,
  swapFuncParams: SwapFuncParams
) {
  clearCache()
  // const diskCache = js.readFileSync(cacheFile)
  // const cachedTransactions = diskCache.txs
  // console.log(`Read txs from cache: ${cachedTransactions.length}`)
  // let newTransactions = []
  // if (!useCache) {
  //   while (newTransactions.length === 0) {
  //     try {
  //       const newQuery = await theFetch()
  //       newTransactions = newQuery.txs
  //       console.log(`Got new transactions... ${newTransactions.length}`)
  //     } catch (e) {
  //       console.log(e)
  //       return
  //     }
  //   }
  // }

  const { endDate } = swapFuncParams
  const { diskCache, newTransactions } = await theFetch(swapFuncParams)
  let cachedTransactions = diskCache.txs

  // Find duplicates
  let numAdded = 0
  const newTxsNoDupes = []
  for (const newTx of newTransactions) {
    let match = false
    for (const oldTx of cachedTransactions) {
      if (
        oldTx.inputTXID === newTx.inputTXID &&
        oldTx.status === newTx.status
      ) {
        match = true
        break
      }
    }
    if (!match) {
      newTxsNoDupes.push(newTx)
      numAdded++
    }
  }
  cachedTransactions = cachedTransactions.concat(newTxsNoDupes)
  cachedTransactions.sort((a, b) => {
    return b.timestamp - a.timestamp
  })

  if (!swapFuncParams.useCache) {
    console.log(
      `*** NEW TXS: ${numAdded.toString()} of downloaded: ${newTransactions.length.toString()}\n`
    )
  }

  diskCache.txs = cachedTransactions
  const out = jsonFormat(diskCache, jsonConfig)
  fs.writeFileSync(cacheFile, out)

  const txDataMap: { [date: string]: TxData } = {}
  let amountTotal = '0'
  let revTotal = '0'
  let grandTotalAmount = '0'
  for (const tx: ShapeShiftTx of cachedTransactions) {
    if (tx.status !== 'complete') {
      continue
    }
    const date: Date = new Date(tx.timestamp * 1000)
    const year = date.getUTCFullYear()
    const month = pad(date.getUTCMonth() + 1, 2)
    const day = pad(date.getUTCDate(), 2)
    const hour = pad(date.getUTCHours(), 2)
    const mins = pad(date.getUTCMinutes(), 2)

    let idx
    const { interval } = swapFuncParams
    if (interval === 'day') {
      idx = `${year}-${month}-${day}`
    } else if (interval === 'month') {
      idx = `${year}-${month}`
    } else if (interval === 'hour') {
      idx = `${year}-${month}-${day}-${hour}`
    } else if (interval === 'mins') {
      idx = `${year}-${month}-${day}-${hour}-${mins}`
    } else {
      idx = `${year}-${month}`
    }

    let idxCompare = idx.replace(/-/g, '')
    idxCompare = padRight(idxCompare, 12)
    let dateCompare = endDate.replace(/-/g, '')
    dateCompare = padRight(dateCompare, 12)

    if (bns.gt(dateCompare, idxCompare)) {
      break
    }

    if (txDataMap[idx] === undefined) {
      txDataMap[idx] = {
        txCount: 0,
        amountBtc: '0',
        amountUsd: '0',
        // avgBtc: '0',
        // avgUsd: '0',
        currencyAmount: {}
      }
    }
    txDataMap[idx].txCount++

    let amountBtc: string = '0'
    let amountUsd: string = '0'
    // kylan - libertyX gives USD amounts
    if (
      tx.inputCurrency === 'USD' &&
      tx.outputCurrency === 'USD'
    ) {
      amountBtc = '0'
      amountUsd = tx.outputAmount
    } else {
      // kylan - most partners
      if (tx.inputCurrency === 'BTC') {
        amountBtc = tx.inputAmount.toString()
      } else {
        // kylan - part that gets broken
        // get exchange currency and conver to BTC equivalent for that date and time
        // then find out equivalent amount of BTC
        const rate = await getRate({
          from: tx.inputCurrency,
          to: 'BTC',
          year: year.toString(),
          month,
          day
        })
        // convert BTC to USD
        amountBtc = bns.mul(rate, tx.inputAmount.toString())
      }
      const btcRate = await getPairCached(
        'BTC',
        `${year.toString()}-${month}-${day}`
      )
      amountUsd = bns.mul(amountBtc, btcRate)
    }
    // now stick it into the txDataMap
    txDataMap[idx].amountBtc = bns.add(txDataMap[idx].amountBtc, amountBtc)
    txDataMap[idx].amountUsd = bns.add(txDataMap[idx].amountUsd, amountUsd)
    const rev = bns.mul(amountBtc, '0.0025')
    // txDataMap[idx].avgBtc = bns.div(txDataMap[idx].amountBtc, txDataMap[idx].txCount.toString(), 4)
    // txDataMap[idx].avgUsd = bns.div(txDataMap[idx].amountUsd, txDataMap[idx].txCount.toString(), 2)

    amountTotal = bns.add(amountTotal, amountBtc)
    grandTotalAmount = bns.add(grandTotalAmount, amountBtc)
    revTotal = bns.add(revTotal, rev)
    // and also credit to altcoin numbers
    if (txDataMap[idx].currencyAmount[tx.inputCurrency] === undefined) {
      txDataMap[idx].currencyAmount[tx.inputCurrency] = '0'
    }

    if (txDataMap[idx].currencyAmount[tx.outputCurrency] === undefined) {
      txDataMap[idx].currencyAmount[tx.outputCurrency] = '0'
    }

    const halfAmount = bns.div(amountUsd, '2', 2)

    txDataMap[idx].currencyAmount[tx.inputCurrency] = bns.add(
      txDataMap[idx].currencyAmount[tx.inputCurrency],
      halfAmount
    )
    txDataMap[idx].currencyAmount[tx.outputCurrency] = bns.add(
      txDataMap[idx].currencyAmount[tx.outputCurrency],
      halfAmount
    )
  }

  // console.log(txCountMap)
  // console.log(amountBtcMap)
  // console.log(avgBtcMap)
  // console.log(
  //   'avg tx size: ' +
  //     (parseInt(grandTotalAmount) / cachedTransactions.length).toString()
  // )
  return txDataMap
}

module.exports = { checkSwapService }
