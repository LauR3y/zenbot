#!/usr/bin/env node

var Nash = require('@neon-exchange/api-client-typescript')
var nash = new Nash.Client(Nash.EnvironmentConfiguration.production)

var products = []

nash.listMarkets().then((markets) => {
    console.warn('markets', markets)
    markets.map((m) => {
        products.push({
            asset: m.aUnit.toUpperCase(),
            currency: m.bUnit.toUpperCase(),
            min_size: m.minTradeSize,
            increment: m.minTradeIncrement,
            label: m.aUnit.toUpperCase() + '/' + m.bUnit.toUpperCase(),
        })
    })

    var target = require('path').resolve(__dirname, 'products.json')
    require('fs').writeFileSync(target, JSON.stringify(products, null, 2))
    console.log('wrote', target)
    process.exit()
})