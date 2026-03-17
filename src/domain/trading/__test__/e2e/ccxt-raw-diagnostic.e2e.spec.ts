/**
 * Raw CCXT diagnostic — no broker wrapper, just exchange methods.
 * Purpose: understand what Bybit demoTrading actually returns.
 */

import { describe, it, beforeAll, afterAll } from 'vitest'
import ccxt from 'ccxt'
import { loadTradingConfig } from '@/core/config.js'

let exchange: InstanceType<typeof ccxt.bybit> | null = null

beforeAll(async () => {
  const { platforms, accounts } = await loadTradingConfig()
  const bybitPlatform = platforms.find(p => p.type === 'ccxt' && p.exchange === 'bybit')
  if (!bybitPlatform) { console.log('No Bybit platform configured'); return }
  const bybitAccount = accounts.find(a => a.platformId === bybitPlatform.id && a.apiKey)
  if (!bybitAccount) { console.log('No Bybit account with API key'); return }

  exchange = new ccxt.bybit({
    apiKey: bybitAccount.apiKey,
    secret: bybitAccount.apiSecret,
    enableRateLimit: true,
    options: { fetchMarkets: { types: ['linear', 'inverse'] } },
  })

  if ('sandbox' in bybitPlatform && bybitPlatform.sandbox) {
    exchange.setSandboxMode(true)
  }
  if ('demoTrading' in bybitPlatform && bybitPlatform.demoTrading) {
    (exchange as any).enableDemoTrading(true)
  }

  await exchange.loadMarkets()
  console.log(`Connected to Bybit, ${Object.keys(exchange.markets).length} markets`)
}, 30_000)

afterAll(async () => {
  // no-op
})

describe('Raw CCXT Bybit diagnostic', () => {
  it('createOrder → inspect full response', async () => {
    if (!exchange) return

    const result = await exchange.createOrder('ETH/USDT:USDT', 'market', 'buy', 0.01)
    console.log('\n=== createOrder response ===')
    console.log(JSON.stringify({
      id: result.id,
      clientOrderId: result.clientOrderId,
      status: result.status,
      symbol: result.symbol,
      type: result.type,
      side: result.side,
      amount: result.amount,
      filled: result.filled,
      remaining: result.remaining,
      average: result.average,
      price: result.price,
      cost: result.cost,
      datetime: result.datetime,
      timestamp: result.timestamp,
      fee: result.fee,
      info: result.info, // raw exchange response
    }, null, 2))
  }, 15_000)

  it('fetchClosedOrders → inspect ids and format', async () => {
    if (!exchange) return

    const closed = await exchange.fetchClosedOrders('ETH/USDT:USDT', undefined, 5)
    console.log(`\n=== fetchClosedOrders: ${closed.length} orders ===`)
    for (const o of closed) {
      console.log(JSON.stringify({
        id: o.id,
        clientOrderId: o.clientOrderId,
        status: o.status,
        symbol: o.symbol,
        side: o.side,
        amount: o.amount,
        filled: o.filled,
        average: o.average,
        datetime: o.datetime,
      }))
    }
  }, 15_000)

  it('fetchOpenOrders → inspect', async () => {
    if (!exchange) return

    const open = await exchange.fetchOpenOrders('ETH/USDT:USDT')
    console.log(`\n=== fetchOpenOrders: ${open.length} orders ===`)
    for (const o of open) {
      console.log(JSON.stringify({
        id: o.id,
        status: o.status,
        symbol: o.symbol,
        side: o.side,
        amount: o.amount,
      }))
    }
  }, 15_000)

  it('check market.id vs market.symbol for ETH perps', async () => {
    if (!exchange) return
    const candidates = Object.values(exchange.markets).filter(
      m => m.base === 'ETH' && m.quote === 'USDT',
    )
    console.log('\n=== ETH/USDT markets ===')
    for (const m of candidates) {
      console.log(`  id=${m.id} symbol=${m.symbol} type=${m.type} settle=${m.settle}`)
    }
  })

  it('createOrder → then immediately fetchClosedOrders → find it?', async () => {
    if (!exchange) return

    const placed = await exchange.createOrder('ETH/USDT:USDT', 'market', 'buy', 0.01)
    console.log(`\n=== placed id: ${placed.id} (type: ${typeof placed.id}) ===`)

    // Small delay to let exchange process
    await new Promise(r => setTimeout(r, 1000))

    const closed = await exchange.fetchClosedOrders('ETH/USDT:USDT', undefined, 10)
    console.log(`fetchClosedOrders returned ${closed.length} orders`)

    const ids = closed.map(o => o.id)
    console.log(`ids: ${JSON.stringify(ids)}`)

    const found = closed.find(o => o.id === placed.id)
    console.log(`match by === : ${found ? 'FOUND' : 'NOT FOUND'}`)

    const foundStr = closed.find(o => String(o.id) === String(placed.id))
    console.log(`match by String(): ${foundStr ? 'FOUND' : 'NOT FOUND'}`)

    // Clean up
    await exchange.createOrder('ETH/USDT:USDT', 'market', 'sell', 0.02, undefined, { reduceOnly: true }).catch(() => {})
  }, 30_000)
})
