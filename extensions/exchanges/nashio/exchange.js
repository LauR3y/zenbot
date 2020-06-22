var Nash = require('@neon-exchange/api-client-typescript')
var minimist = require('minimist')

function OrderBook () {
  const asks = {}
  const bids = {}

  const update = function (updatedAsks, updatedBids) {
    updatedAsks.forEach((updatedAsk) => {
      if (parseFloat(updatedAsk.amount.amount) === 0.0) {
        // delete
        delete asks[updatedAsk.price.amount]
      } else {
        asks[updatedAsk.price.amount] = updatedAsk.amount.amount
      }
    })
    updatedBids.forEach((updatedBid) => {
      if (parseFloat(updatedBid.amount.amount) === 0.0) {
        // delete
        delete bids[updatedBid.price.amount]
      } else {
        bids[updatedBid.price.amount] = updatedBid.amount.amount
      }
    })
  }

  const getBestBid = function () {
    const bidsList = Object.keys(bids).map((b) => parseFloat(b))
    return Math.max(...bidsList)
  }

  const getBestAsk = function () {
    const asksList = Object.keys(asks).map((a) => parseFloat(a))
    return Math.min(...asksList)
  }

  return {
    update,
    getBestBid,
    getBestAsk,
  }
}

function Trades () {
  let history = []

  const add = function (newTrades, next) {
    newTrades.forEach((newTrade) => {
      const historyEntry = {
        trade_id: newTrade.id,
        time: new Date(newTrade.executedAt).getTime(),
        timeExecuted: new Date(new Date(newTrade.executedAt).getTime()),
        executedAt: newTrade.executedAt,
        size: parseFloat(newTrade.amount.amount),
        price: parseFloat(newTrade.limitPrice.amount),
        side: newTrade.direction === 'BUY' ? 'buy' : 'sell',
      }

      if (next) {
        historyEntry.next = parseInt(next, 10)
      }

      history.push(historyEntry)
    })
  }

  const get = function () {
    return history
  }

  const clear = function () {
    history = []
  }

  return {
    add,
    get,
    clear,
  }
}

module.exports = function nashio (conf) {
  // console.warn('conf', conf.nashio)
  let s = {
    options: minimist(process.argv)
  }
  let so = s.options
  var client, websocket_client
  var ws_trades = {}
  var ws_orderbooks = {}
  var loggedIn = false

  function useWebSockets () {
    // console.warn('useWebSockets', so._[2])
    return so._[2] !== 'backfill'
  }

  function publicClient() {
    if (!client) {
      if (conf.nashio.sandbox) {
        const options = Nash.EnvironmentConfiguration.sandbox
        options.debug = true
        client = new Nash.Client(options)
      } else {
        client = new Nash.Client(Nash.EnvironmentConfiguration.production)
      }
    }
    return client
  }

  function authedClient() {
    if (!client) {
      if (conf.nashio.sandbox) {
        const options = Nash.EnvironmentConfiguration.sandbox
        options.debug = true
        client = new Nash.Client(options)
      } else {
        client = new Nash.Client(Nash.EnvironmentConfiguration.production)
      }
    }
    return client
  }

  function login (cb) {
    if (!client) {
      authedClient()
    }

    if (!loggedIn) {
      const loginData = {
        apiKey: conf.nashio.apiKey,
        secret: conf.nashio.secret,
      }

      client.login(loginData).then(() => {
        websocket_client = client.createSocketConnection()
        // console.warn('login.response', response)
        loggedIn = true
        cb()
      }).catch((error) => {
        console.error('error', error)
      })
    } else {
      cb()
    }
  }

  function wsTrades (product_id) {
    var marketName = product_id.replace('-', '_').toLowerCase()
    // console.warn('sub.newTrades', Object.keys(websocket_client))
    // console.warn(ws_trades[product_id])

    websocket_client.onNewTrades({ marketName }, {
      onResult: (response) => {
        // console.warn('wsTrades', response.data.newTrades)
        ws_trades[product_id].add(response.data.newTrades, undefined)
      },
      onError: (error) => {
        console.error('onError', error)
      },
      onAbort: (reason) => {
        console.error('onAbort', reason)
      },
    })
  }

  function wsOrderBook (product_id) {
    var marketName = product_id.replace('-', '_').toLowerCase()

    websocket_client.onUpdatedOrderbook({ marketName }, {
      onResult: (response) => {
        var asks = response.data.updatedOrderBook.asks
        var bids = response.data.updatedOrderBook.bids
        // console.warn('wsOrderBook', product_id, response.data.updatedOrderBook, asks, bids)
        ws_orderbooks[product_id].update(asks, bids)
      },
      onError: (error) => {
        console.error('onError', error)
      },
      onAbort: (reason) => {
        console.error('onAbort', reason)
      },
    })
  }

  function statusErr (resp, body) {
    if (resp.statusCode !== 200) {
      console.warn('statusErr', resp)
      var err = new Error('non-200 status: ' + resp.statusCode)
      err.code = 'HTTP_STATUS'
      err.body = body
      return err
    } else {
      console.error('statusErr', resp, body)
    }
  }

  var orders = {}
  var exchange = {
    name: 'nashio',
    historyScan: 'backward',
    historyScanUsesTime: false,
    makerFee: 0,
    takerFee: 0.25,
    backfillRateLimit: 0,

    getProducts: function() {
      return require('./products.json')
    },

    getTrades: function(opts, cb) {
      // console.warn('getTrades', opts)
      login(() => {
        if (useWebSockets() && ws_trades[opts.product_id]) {
          var trades = ws_trades[opts.product_id].get()
          // console.warn('getTrades from websocket', opts, trades)
          // get from webssocket
          cb(null, trades)
          ws_trades[opts.product_id].clear()
        } else if (useWebSockets() === false) {
          if (!ws_trades[opts.product_id]) {
            // create
            ws_trades[opts.product_id] = new Trades()
          }
          // get from graphapi
          // console.warn('getTrades from graphapi', opts)
          var client = publicClient()
          var marketName = opts.product_id.replace('-', '_').toLowerCase()
          var before = opts.to ? opts.to.toString() : undefined
          // var limit = 50
          const params = { marketName, before }
          client.listTrades(params).then((response) => {
            // console.warn('getTrades.response', response.trades)
            ws_trades[opts.product_id].add(response.trades, response.next)
    
            // console.warn('trades', trades)
            cb(null, ws_trades[opts.product_id].get())
            ws_trades[opts.product_id].clear()

          }).catch(statusErr)
        } else {
          if (!ws_trades[opts.product_id]) {
            // create
            ws_trades[opts.product_id] = new Trades()

            if (useWebSockets()) {
              // start listening
              wsTrades(opts.product_id)
            }
          }  
          
        }
      })
    },

    getBalance: function(opts, cb) {
      console.warn('getBalance.opts', opts)
      var client = authedClient()
      login(() => {
        var CryptoCurrencyCurrency = Nash.CryptoCurrency[opts.currency]
        var CryptoCurrencyAssset = Nash.CryptoCurrency[opts.asset]
        client.getAccountBalance(CryptoCurrencyCurrency).then((responseCurrency) => {
          console.warn('getAccountBalance', responseCurrency)
          // throw new Error('NotImplement')
          client.getAccountBalance(CryptoCurrencyAssset).then((responseAsset) => {
            console.warn('getAccountBalance', responseCurrency, responseAsset)

            var balance = {
              asset: responseCurrency.available.amount,
              asset_hold: '0',
              currency: responseAsset.available.amount,
              currency_hold: '0'
            }

            cb(null, balance)
          }).catch(statusErr)
        }).catch(statusErr)
      })
    },

    getQuote(opts, cb) {
      // console.warn('getQuote', opts)
      login(() => {
        if (useWebSockets() && ws_orderbooks[opts.product_id]) {
          var bestBid = ws_orderbooks[opts.product_id].getBestBid()
          var bestAsk = ws_orderbooks[opts.product_id].getBestAsk()
          // console.warn('getQuote from websocket', opts, bestBid, bestAsk)
          cb(null, { bid: bestBid, ask: bestAsk })
        } else {
          if (!ws_orderbooks[opts.product_id]) {
            // create
            ws_orderbooks[opts.product_id] = new OrderBook()

            if (useWebSockets()) {
              // start listening to websocket
              wsOrderBook(opts.product_id)
            }
          }

          // console.warn('getQuote.opts', opts)
          var client = publicClient()
          var marketName = opts.product_id.replace('-', '_').toLowerCase()
          client.getOrderBook(marketName).then((response) => {
            // console.warn('getOrderBook', 'response', response)
            ws_orderbooks[opts.product_id].update(response.asks, response.bids)
            var bestBid = ws_orderbooks[opts.product_id].getBestBid()
            var bestAsk = ws_orderbooks[opts.product_id].getBestAsk()
            // console.warn('getQuote from api', opts, bestBid, bestAsk)
            cb(null, { bid: bestBid, ask: bestAsk })

          }).catch(statusErr)
        }
      })
    },

    cancelOrder: function(opts, cb) {
      var client = authedClient()
      login(() => {
        client.cancelledOrder(opts.order_id).then(() => {
          cb()
        }).catch((error) => {
          cb(error)
        })
      })
    },

    trade: function(buyOrSell, opts, cb) {
      // console.warn('trade', buyOrSell, opts)
      // throw new Error('Invalid')
      var client = authedClient()
      login(() => {
        var postOnly = !!opts.post_only
        var pair = opts.product_id.split('-')
        var amount = Nash.createCurrencyAmount(opts.size, Nash.CryptoCurrency[pair[0]])
        var marketName = opts.product_id.replace('-', '_').toLowerCase()
        if (opts.order_type === 'taker') {
          // market order
          client.placeMarketOrder(
            amount,
            buyOrSell,
            marketName,
          ).then((response) => {
            console.warn('trade.taker.response', response)
            var order = {
              id: response.id,
              status: 'open',
              price: null,
              size: null,
              created_at: new Date().getTime(),
              filled_size: '0',
              postonly: postOnly,
            }

            orders['~' + response.id] = order
            cb(null, order)
          }).catch((error) => {
            console.warn(error)
            // TODO: check for balance error
            cb(null, {
              status: 'rejected',
              // reject_reason: 'balance'
            })
          })
        } else {
          // limit order
          const price = Nash.createCurrencyPrice(opts.price, Nash.CryptoCurrency[pair[1]], Nash.CryptoCurrency[pair[0]])
          client.placeLimitOrder(
            postOnly,
            amount,
            buyOrSell,
            Nash.OrderCancellationPolicy.GOOD_TIL_CANCELLED,
            price,
            marketName,
          ).then((response) => {
            console.warn('trade.limit.response', response)
            var order = {
              id: response.id,
              status: 'open',
              price: price.amount,
              size: amount.amount,
              created_at: new Date().getTime(),
              filled_size: '0',
              postonly: postOnly,
            }

            orders['~' + response.id] = order
            cb(null, order)
          }).catch((error) => {
            console.warn(error)
            // TODO: check for balance error
            cb(null, {
              status: 'rejected',
              // reject_reason: 'balance'
            })
          })
        }
      })
    },

    buy: function(opts, cb) {
      exchange.trade(Nash.OrderBuyOrSell.BUY, opts, cb)
    },

    sell: function(opts, cb) {
      exchange.trade(Nash.OrderBuyOrSell.SELL, opts, cb)
    },

    getOrder: function(opts, cb) {
      var order = orders['~' + opts.order_id]
      var client = authedClient()
      login(() => {
        client.getAccountOrder(opts.order_id).then((response) => {
          switch(response) {
          case Nash.OrderStatus.CANCELLED:
            order.status = 'rejected'
            break
          case Nash.OrderStatus.FILLED:
            order.status = 'done'
            break
          case Nash.OrderStatus.OPEN:
          case Nash.OrderStatus.PENDING:
            order.status = 'open'
            break
          }
          cb(null, order)
        }).catch(statusErr)
      })
    },

    getCursor: function (trade) {
      // console.warn('getCursor', trade, useWebSockets())
      if (useWebSockets() === false) {
        return trade.next
      }
      return trade.time
      // return trade.time
    }

  }

  return exchange
}