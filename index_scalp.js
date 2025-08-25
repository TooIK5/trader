const WebSocket = require('ws');
const ccxt = require('ccxt');
const fs = require('fs');

const blessed = require('blessed');
const contrib = require('blessed-contrib');

// 1. Получение данных о сделках
async function getRecentTrades(symbol = 'SOL/USDT', limit = 20) {
    const exchange = new ccxt.binance();
    try {
        const trades = await exchange.fetchTrades(symbol, undefined, limit);
  
        return trades.map(trade => ({
            id: trade.id,
            timestamp: new Date(trade.timestamp).toLocaleTimeString(),
            price: parseFloat(trade.price).toFixed(4),
            amount: parseFloat(trade.amount).toFixed(4),
            side: trade.side || (trade.takerOrMaker === 'maker' ? 'buy' : 'sell'),
            cost: parseFloat(trade.cost).toFixed(2)
        }));
    } catch (error) {
        console.error('Ошибка получения сделок:', error);
        return [];
    }
}

function visualizeTrades(trades) {
    // Создаем экран
    const screen = blessed.screen();
    const grid = new contrib.grid({ rows: 1, cols: 1, screen: screen });
    
    // Создаем таблицу
    const table = grid.set(0, 0, 1, 1, contrib.table, {
        keys: true,
        label: `Последние ${trades.length} сделок (SOL/USDT)`,
        columnSpacing: 2,
        columnWidth: [10, 12, 10, 10, 8, 12]
    });
    
    // Форматируем данные для таблицы
    const data = {
        headers: ['ID', 'Время', 'Цена', 'Кол-во', 'Сторона', 'Стоимость'],
        data: trades.map(t => [
            t.id.slice(-6),
            t.timestamp,
            t.price,
            t.amount,
            t.side,
            t.cost + ' USDT'
        ])
    };
    
    table.setData(data);
    screen.render();
    
    // Выход по нажатию q
    screen.key(['q', 'C-c'], () => process.exit(0));
}

async function startBless() {
    console.log('Загружаем последние сделки...');
    const trades = await getRecentTrades();
    
    if (trades.length > 0) {
        console.log('\nТекстовый вывод (первые 3 сделки):');
        console.table(trades.slice(0, 3));
        
        console.log('\nЗапускаем визуализацию...');
        visualizeTrades(trades);
    } else {
        console.log('Не удалось получить данные о сделках');
    }
}

// Настройки
const SYMBOL = 'SOL/USDT';
const STATS_FILE = 'scalper_stats.json';
const WS_DEPTH_URL = `wss://stream.binance.com:9443/ws/${SYMBOL.toLowerCase().replace('/', '')}@depth@100ms`;
const TRADE_AMOUNT = 0.1;
const SPREAD_TARGET = 0.005;     // 0.28%
const VOLUME_IMBALANCE = 1.05;     // 28% дисбаланс
const TAKE_PROFIT = 0.002;        // 0.18%
const STOP_LOSS = -0.001;          // 0.12%
const MAX_POSITION_TIME = 20000;    // 20 сек

// Состояние системы
let orderBook = { bids: [], asks: [] };
let currentPosition = null;
let stats = {
    total: 0,
    profitable: 0,
    unprofitable: 0,
    winRate: 0,
    trades: []
};

const exchange = new ccxt.binance({ enableRateLimit: true });

async function initializeOrderBook() {
    try {
        const snapshot = await exchange.fetchOrderBook(SYMBOL, 50); // Берем больше уровней
        orderBook = {
            bids: snapshot.bids,
            asks: snapshot.asks
        };
        console.log('Order book initialized');
        logOrderBookStatus(); // Добавляем логирование стакана
    } catch (err) {
        console.error('Failed to initialize order book:', err);
    }
}

function logOrderBookStatus() {
    const { bestBid, bestAsk } = getBestPrices();
    if (!bestBid || !bestAsk) return;
    
    const spread = (bestAsk - bestBid) / bestBid;
    console.log(`Current prices: Bid ${bestBid} | Ask ${bestAsk} | Spread ${(spread*100).toFixed(2)}%`);
}

function getBestPrices() {
    if (!orderBook.bids?.length || !orderBook.asks?.length) {
        return { bestBid: null, bestAsk: null };
    }
    return {
        bestBid: orderBook.bids[0][0],
        bestAsk: orderBook.asks[0][0]
    };
}

function loadStats() {
    if (fs.existsSync(STATS_FILE)) {
        stats = JSON.parse(fs.readFileSync(STATS_FILE));
        console.log(`Loaded stats: ${stats.profitable} wins, ${stats.unprofitable} losses`);
    }
}

function saveStats() {
    stats.winRate = stats.total > 0 ? (stats.profitable / stats.total * 100).toFixed(2) : 0;
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

function analyzeOrderBook() {
    if (currentPosition) return;

    // const { bestBid, bestAsk } = getBestPrices();
    // if (bestBid === null || bestAsk === null) {
    //     console.log('Waiting for order book data...');
    //     return;
    // }

    // const spread = (bestAsk - bestBid) / bestBid;
    // console.log(`Spread: ${(spread*100).toFixed(2)}% (Target: ${(SPREAD_TARGET*100).toFixed(2)}%)`);

    // if (spread <= SPREAD_TARGET) {
    //     if (orderBook.bids.length < 5 || orderBook.asks.length < 5) {
    //         console.log('Not enough depth in order book');
    //         return;
    //     }
        
    //     const bidsVolume = orderBook.bids.slice(0, 5).reduce((sum, [p,a]) => sum + a, 0);
    //     const asksVolume = orderBook.asks.slice(0, 5).reduce((sum, [p,a]) => sum + a, 0);
    //     console.log(`Volumes: Bids ${bidsVolume.toFixed(2)} | Asks ${asksVolume.toFixed(2)} | Ratio ${(bidsVolume/asksVolume).toFixed(2)}`);

    //     if (bidsVolume > asksVolume * VOLUME_IMBALANCE) {
    //         openPosition('long', bestAsk);
    //     } else if (asksVolume > bidsVolume * VOLUME_IMBALANCE) {
    //         openPosition('short', bestBid);
    //     }
    // }
}

function openPosition(side, price) {
    currentPosition = {
        side,
        entryPrice: price,
        entryTime: Date.now(),
        timeout: setTimeout(() => closePosition('timeout'), MAX_POSITION_TIME)
    };
    console.log(`\n[${new Date().toLocaleTimeString()}] OPEN ${side.toUpperCase()} at ${price}`);
}

function closePosition(reason) {
    if (!currentPosition) return;

    const exitPrice = getCurrentExitPrice();
    const isProfit = currentPosition.side === 'long' 
        ? exitPrice > currentPosition.entryPrice
        : exitPrice < currentPosition.entryPrice;

    const pnl = currentPosition.side === 'long'
        ? ((exitPrice - currentPosition.entryPrice) / currentPosition.entryPrice * 100).toFixed(4)
        : ((currentPosition.entryPrice - exitPrice) / currentPosition.entryPrice * 100).toFixed(4);

    stats.total++;
    isProfit ? stats.profitable++ : stats.unprofitable++;
    stats.trades.push({
        ...currentPosition,
        exitPrice,
        pnl,
        reason,
        duration: Date.now() - currentPosition.entryTime
    });
    saveStats();

    console.log(`[${new Date().toLocaleTimeString()}] CLOSE ${currentPosition.side.toUpperCase()} | PnL: ${pnl}% | Reason: ${reason}`);
    console.log(`Stats: ${stats.profitable}W/${stats.unprofitable}L (${stats.winRate}% WR)\n`);

    clearTimeout(currentPosition.timeout);
    currentPosition = null;
}

function getCurrentExitPrice() {
    const { bestBid, bestAsk } = getBestPrices();
    return currentPosition?.side === 'long' ? bestBid : bestAsk;
}


async function start() {
    await initializeOrderBook();
    await startBless();
    loadStats();

    const ws = new WebSocket(WS_DEPTH_URL);
    
    ws.on('open', () => {
        console.log(`Connected to ${SYMBOL} stream`);
        // Первоначальный анализ после подключения
        setTimeout(() => analyzeOrderBook(), 1000);
    });
    
    ws.on('message', data => {
    try {
        const update = JSON.parse(data);
        // Принудительный триггер анализа после обновления
        //setImmediate(() => analyzeOrderBook()); 
    } catch (err) {
        console.error('WS error:', err);
    }
});

    process.on('SIGINT', () => {
        console.log('\nSaving stats before exit...');
        saveStats();
        process.exit();
    });
}

start().catch(console.error);