const ccxt = require('ccxt');
const regression = require('regression');
const { mean, std, min, max } = require('mathjs');
const fs = require('fs');
const WebSocket = require('ws');

// Настройки
const SYMBOL = 'SOL/USDT';
const TIME_FRAME = '1h';
const LIMIT = 24;
const SMA_PERIOD = 6;
const STATS_FILE = 'trading_stats.json';
const WS_URL = 'wss://stream.binance.com:9443/ws/solusdt@ticker';

let ohlcvData = [];
let lastAnalysisTime = 0;

// Параметры комиссий и прибыли
const MAKER_FEE = 0.0002; // 0.02% комиссия мейкера
const TAKER_FEE = 0.0004; // 0.04% комиссия тейкера
 
//const MIN_ABSOLUTE_PROFIT = 0.50; // $0.50 минимальная абсолютная прибыль
const TRADE_AMOUNT = 0.1;

const MIN_PROFIT_PERCENT = 0.005; // 0.5% минимальная прибыль
const MIN_LOSS_PERCENT = 0.01; // 1.0% минимальный стоп-лосс
const PROTECTION_INTERVAL = 30000; // 30 сек защитный интервал

// Состояние системы
let currentTrade = null;
let currentPrice = null;
let stats = {
    total: 0,
    wins: 0,
    losses: 0,
    breakeven: 0, // Сделки без прибыли/убытка
    winRate: 0,
    trades: []
};

// Инициализация WebSocket

   let ws;
 
   function initWebSocket() {
    return new Promise((resolve) => {
        if (ws) {
            ws.removeAllListeners();
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        }

        ws = new WebSocket(WS_URL);

        ws.on('open', () => {
            console.log('WebSocket подключен к Binance');
            resolve();
        });

        ws.on('message', (data) => {
            try {
                const ticker = JSON.parse(data);
                if (ticker && ticker.c) {
                    currentPrice = parseFloat(ticker.c);
                    if (currentTrade) {
                        checkTrade();
                    }
                }
            } catch (e) {
                console.error('Ошибка обработки цены:', e);
            }
        });

        ws.on('error', (err) => {
            console.error('WebSocket error:', err);
            setTimeout(initWebSocket, 5000);
        });

        ws.on('close', () => {
            console.log('WebSocket соединение закрыто, переподключаемся...');
            setTimeout(initWebSocket, 5000);
        });
    });
}


// Загружаем статистику
function loadStats() {
    try {
        if (fs.existsSync(STATS_FILE)) {
            stats = JSON.parse(fs.readFileSync(STATS_FILE));
            console.log(`Загружена статистика: ${stats.wins}W/${stats.losses}L (${stats.winRate}%)`);
        }
    } catch (e) {
        console.log('Новая статистика будет создана');
    }
}

// Сохраняем статистику
function saveStats() {
    stats.winRate = stats.total > 0 ? (stats.wins / stats.total * 100).toFixed(2) : 0;
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}
 

// Проверка сделки с учетом комиссий
function checkTrade() {
    if (!currentTrade || !currentPrice || 
        Date.now() - currentTrade.entryTime < PROTECTION_INTERVAL) {
        return;
    }

    // Добавляем комиссии к расчетам
    const entryWithFee = currentTrade.direction === 'long' 
        ? currentTrade.entryPrice * (1 + TAKER_FEE)
        : currentTrade.entryPrice * (1 - TAKER_FEE);
        
    const exitWithFee = currentTrade.direction === 'long'
        ? currentPrice * (1 - MAKER_FEE)
        : currentPrice * (1 + MAKER_FEE);

    const currentPnl = currentTrade.direction === 'long'
        ? (exitWithFee - entryWithFee) / entryWithFee
        : (entryWithFee - exitWithFee) / entryWithFee;

    // Рассчитываем абсолютную прибыль
    const absoluteProfit = currentTrade.direction === 'long'
        ? (currentPrice - currentTrade.entryPrice) * currentTrade.amount
        : (currentTrade.entryPrice - currentPrice) * currentTrade.amount;

    // Условия закрытия с учетом комиссий
    if (currentPrice >= currentTrade.takeProfit && currentTrade.direction === 'long') {
        closeTrade('win', currentPnl * 100, absoluteProfit);
    } 
    else if (currentPrice <= currentTrade.stopLoss && currentTrade.direction === 'long') {
        closeTrade('loss', currentPnl * 100, absoluteProfit);
    }
    else if (currentPrice <= currentTrade.takeProfit && currentTrade.direction === 'short') {
        closeTrade('win', currentPnl * 100, absoluteProfit);
    }
    else if (currentPrice >= currentTrade.stopLoss && currentTrade.direction === 'short') {
        closeTrade('loss', currentPnl * 100, absoluteProfit);
    }
}

// Закрытие сделки с детальной статистикой
function closeTrade(result, profitPercent, absoluteProfit) {
    // Останавливаем интервал проверки
    if (tradeCheckInterval) {
        clearInterval(tradeCheckInterval);
        tradeCheckInterval = null;
    }
    
    const tradeResult = {
        ...currentTrade,
        exitPrice: currentPrice,
        result,
        profitPercent: parseFloat(profitPercent.toFixed(4)),
        absoluteProfit: parseFloat(absoluteProfit.toFixed(2)),
        fees: {
            entry: TAKER_FEE * currentTrade.entryPrice * currentTrade.amount,
            exit: MAKER_FEE * currentPrice * currentTrade.amount
        },
        exitTime: new Date().toISOString()
    };

    stats.total++;
    if (result === 'win') stats.wins++;
    else if (result === 'loss') stats.losses++;
    else stats.breakeven++;
    
    stats.trades.push(tradeResult);
    saveStats();

    console.log(`\n${getResultEmoji(result)} ${result.toUpperCase()} сделка`);
    console.log(`Направление: ${currentTrade.direction.toUpperCase()}`);
    console.log(`Вход: ${currentTrade.entryPrice} | Выход: ${currentPrice}`);
    console.log(`Прибыль: ${profitPercent.toFixed(4)}% (${absoluteProfit.toFixed(2)} USDT)`);
    console.log(`Комиссии: вход ${tradeResult.fees.entry.toFixed(2)} USDT, выход ${tradeResult.fees.exit.toFixed(2)} USDT`);
    console.log(`Общая статистика: ${stats.wins}W/${stats.losses}L/${stats.breakeven}B (${stats.winRate}% win rate)`);

    currentTrade = null;
}

function getResultEmoji(result) {
    return {
        win: '✅',
        loss: '❌',
        breakeven: '➖'
    }[result];
}

async function startAnalysis() {
    const exchange = new ccxt.binance();
    
    // Ждем инициализации цены
    console.log('Ожидание начальной цены...');
    while (!currentPrice) {
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('Начало анализа. Текущая цена:', currentPrice);

    while (true) {
        try {
            // Обновляем OHLCV данные каждые 5 минут
            const ohlcv = await exchange.fetchOHLCV(SYMBOL, TIME_FRAME, undefined, LIMIT);
            const closes = ohlcv.map(candle => candle[4]);
            
            // Рассчитываем индикаторы
            const sma = calculateSMA(closes, SMA_PERIOD);
            const lastClose = closes[closes.length - 1];
            const prevClose = closes[closes.length - 2];
            const smaValue = sma[sma.length - 1];

            // Определяем тренд
            const isUptrend = currentPrice > smaValue && 
                             currentPrice > lastClose &&
                             lastClose > prevClose;

            const isDowntrend = currentPrice < smaValue && 
                               currentPrice < lastClose &&
                               lastClose < prevClose;

            console.log('\n--- Анализ ---');
            console.log(`Текущая цена: ${currentPrice}`);
            console.log(`Последние закрытия: ${prevClose.toFixed(2)}, ${lastClose.toFixed(2)}`);
            console.log(`SMA(${SMA_PERIOD}): ${smaValue.toFixed(2)}`);
            console.log(`Тренд: ${isUptrend ? 'UP' : isDowntrend ? 'DOWN' : 'NEUTRAL'}`);

            if (!currentTrade) {
                if (isUptrend) {
                    currentTrade = {
                        direction: 'long',
                        entryPrice: currentPrice,
                        takeProfit: currentPrice * (1 + MIN_PROFIT_PERCENT),
                        stopLoss: currentPrice * (1 - MIN_LOSS_PERCENT),
                        amount: TRADE_AMOUNT,
                        entryTime: Date.now()
                    };
                    logTradeOpening('LONG', currentTrade);
                } 
                else if (isDowntrend) {
                    currentTrade = {
                        direction: 'short',
                        entryPrice: currentPrice,
                        takeProfit: currentPrice * (1 - MIN_PROFIT_PERCENT),
                        stopLoss: currentPrice * (1 + MIN_LOSS_PERCENT),
                        amount: TRADE_AMOUNT,
                        entryTime: Date.now()
                    };
                    logTradeOpening('SHORT', currentTrade);
                }
            }

            // Проверяем условия выхода
            if (currentTrade) {
                checkTrade();
            }

            // Пауза между анализами
            await new Promise(resolve => setTimeout(resolve, 30000)); // 30 секунд

        } catch (error) {
            console.error('Ошибка анализа:', error);
            await new Promise(resolve => setTimeout(resolve, 60000));
        }
    }
}

function calculateSMA(data, period) {
    const sma = [];
    for (let i = period - 1; i < data.length; i++) {
        sma.push(mean(data.slice(i - period + 1, i + 1)));
    }
    return sma;
}

// Вспомогательные функции
function calculateATR(highs, lows, closes, period) {
    const tr = [];
    for (let i = 1; i < highs.length; i++) {
        tr.push(Math.max(
            highs[i] - lows[i],
            Math.abs(highs[i] - closes[i-1]),
            Math.abs(lows[i] - closes[i-1])
        ));
    }
    return mean(tr.slice(-period));
}

let tradeCheckInterval = null;

// Модифицируем функцию открытия сделки
function logTradeOpening(side, trade) {
    const tpPercent = ((trade.takeProfit / trade.entryPrice - 1) * 100 * (side === 'LONG' ? 1 : -1)).toFixed(2);
    const slPercent = ((1 - trade.stopLoss / trade.entryPrice) * 100 * (side === 'LONG' ? 1 : -1)).toFixed(2);
    
    console.log(`\n📈 Открыт ${side}: ${trade.entryPrice.toFixed(2)}`);
    console.log(`TP: ${trade.takeProfit.toFixed(2)} (+${tpPercent}%)`);
    console.log(`SL: ${trade.stopLoss.toFixed(2)} (-${slPercent}%)`);
    console.log(`ATR: ${trade.atr.toFixed(2)} (${(trade.atr/trade.entryPrice*100).toFixed(2)}%)`);
    
    // Запускаем регулярную проверку сделки
    if (tradeCheckInterval) clearInterval(tradeCheckInterval);
    tradeCheckInterval = setInterval(() => {
        if (currentTrade) {
            checkTrade();
        } else {
            clearInterval(tradeCheckInterval);
        }
    }, 5000); // Проверяем каждые 5 секунд
}
 
async function main() {
    await initWebSocket();
    loadStats();
    startAnalysis().catch(console.error);
}

main();

process.on('SIGINT', () => {
    console.log('\nСохранение статистики перед выходом...');
    saveStats();
    process.exit();
});