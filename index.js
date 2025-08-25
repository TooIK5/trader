const WebSocket = require('ws');
const express = require('express');

const app = express();
const HTTP_PORT = 3000;
const WS_PORT = 8081;

let token = 'SOLUSDT';

// Конфигурация

const charTconfig = {
  symbol: token,
  historySize: 200, // Количество точек для хранения истории
  priceHistory: []
};

const config = {
  exchange: 'bybit', // Может быть 'bybit' или 'binance'
  symbol: token,
  orderBookDepth: 500,
  priceHistory: [],
  tradesTracking: {
    minCost: 10, // минимальный объем сделок в $
    calculationPeriod: 5000 // как часто вычисляется отношение покупок и продаж (мс)
  }
};

let wss; // WebSocket сервер
let marketWS; // Соединение с биржей
let stats = {
  buyTrades: 0,
  sellTrades: 0,
  ratio: 0,
  lastCalculationTime: Date.now(),
  percent: 0
};

let filterValue = 0;

// Инициализация WebSocket соединения с биржей
function initMarketWebSocket() {
  if (marketWS) marketWS.close();

  const wsUrl = config.exchange === 'bybit' 
    ? 'wss://stream.bybit.com/v5/public/linear'
    : `wss://fstream.binance.com/ws/${config.symbol.toLowerCase()}@depth${config.orderBookDepth}@100ms`;

  marketWS = new WebSocket(wsUrl);

  marketWS.on('open', () => {
    console.log(`Connected to ${config.exchange.toUpperCase()} WebSocket`);
    
    if (config.exchange === 'bybit') {
      // Подписка на каналы Bybit
      const subscribeRequest = {
        op: "subscribe",
        args: [
          `orderbook.${config.orderBookDepth}.${config.symbol}`,
          `publicTrade.${config.symbol}`,
          `tickers.${config.symbol}`
        ]
      };
      marketWS.send(JSON.stringify(subscribeRequest));
    }
  });

  marketWS.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      
      if (config.exchange === 'bybit') {
        processBybitMessage(message);
      } else {
        processBinanceMessage(message);
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  marketWS.on('close', () => {
    console.log('Market WS disconnected, reconnecting in 5s...');
    setTimeout(initMarketWebSocket, 5000);
  });

  marketWS.on('error', (error) => {
    console.error('Market WS error:', error);
    marketWS.close();
  });
}

// Обработка сообщений от Bybit
function processBybitMessage(message) {
  if (!message.topic) return;

  const topic = message.topic;
  const data = message.data;

  if (topic.includes('orderbook')) {
    processOrderBook(data);
  } 
  else if (topic.includes('publicTrade')) {
    processTrades(data);
  }
  else if (topic.includes('tickers')) {
    processTicker(data);
  }
}

// Обработка сообщений от Binance
function processBinanceMessage(message) {
  if (message.e === 'depthUpdate') {
    processOrderBook(message);
  } 
  else if (message.e === 'trade') {
    processTrades([message]);
  }
  else if (message.e === '24hrTicker') {
    processTicker(message);
  }
}

// Обработка стакана ордеров
 // Добавляем переменную для хранения последних данных стака
let lastOrderBookData = null;
let isProcessing = false;

function processOrderBook(data) {
  let bids, asks;
  
  if (config.exchange === 'bybit') {
    bids = data.b.map(b => [b[0], b[1]]);
    asks = data.a.map(a => [a[0], a[1]]);
  } else {
    bids = data.b || [];
    asks = data.a || [];
  }

  const formattedBook = {
    bids: bids.slice(0, config.orderBookDepth).map(bid => ({
      price: parseFloat(bid[0]).toFixed(4),
      amount: parseFloat(bid[1]).toFixed(4),
      total:  parseFloat(bid[0]) * parseFloat(bid[1]).toFixed(2)
    })),
    asks: asks.slice(0, config.orderBookDepth).map(ask => ({
      price: parseFloat(ask[0]).toFixed(4),
      amount: parseFloat(ask[1]).toFixed(4),
      total: (parseFloat(ask[0]) * parseFloat(ask[1])).toFixed(2)
    }))
  };

  stats.bookDifference = calculateBookDifference(formattedBook);
  
  // Сохраняем данные для обработки
  lastOrderBookData = formattedBook;
  
  broadcast({
    type: 'orderBook',
    data: formattedBook,
    percent: stats.bookDifference
  });
}

// Функция для обработки данных стакана
function processOrderBookForChart() {
  if (!lastOrderBookData || isProcessing) return;
  
  isProcessing = true;
  try {
    calcTradesForChart(lastOrderBookData);
  } catch (error) {
    console.error('Error processing order book for chart:', error);
  } finally {
    isProcessing = false;
    broadcast({
    type: 'chart4orders',
    data: {
      bidCostSum: bidCostSum,
      askCostSum: askCostSum,
      prices: prices
    },
  });
  }
}

// Запускаем обработку каждые 3 секунды
const processingInterval = setInterval(processOrderBookForChart, 3000);

// Для остановки интервала (если нужно)
// clearInterval(processingInterval);

// Обработка сделок
function processTrades(trades) {
  const now = Date.now();
  
  trades.forEach(trade => {
    let price, amount, cost, side;
    
    if (config.exchange === 'bybit') {
      price = trade.p;
      amount = trade.v;
      cost = parseFloat(price) * parseFloat(amount);
      side = trade.S; // 'Buy' или 'Sell'
    } else {
      price = trade.p;
      amount = trade.q;
      cost = parseFloat(price) * parseFloat(amount);
      side = trade.m ? 'Sell' : 'Buy';
    }

    if (cost >= config.tradesTracking.minCost) {
      if (side.toLowerCase() === 'buy') stats.buyTrades++;
      else stats.sellTrades++;
    }

      if (filterValue) {
        if (tradeFilter(cost)) {
      broadcast({
      type: 'trade',
      data: {
        price: parseFloat(price).toFixed(4),
        amount: parseFloat(amount).toFixed(4),
        cost: cost.toFixed(2),
        side: side,
        time: new Date(trade.T || trade.t).toLocaleTimeString()
      }
    });
        }
      } else {
        broadcast({
      type: 'trade',
      data: {
        price: parseFloat(price).toFixed(4),
        amount: parseFloat(amount).toFixed(4),
        cost: cost.toFixed(2),
        side: side,
        time: new Date(trade.T || trade.t).toLocaleTimeString()
      }
    });
      }
 
  });

  if (now - stats.lastCalculationTime >= config.tradesTracking.calculationPeriod) {
    updateRatio();
    stats.lastCalculationTime = now;
  }
}

// Обработка тикера
function processTicker(data) {
  let lastPrice, priceChange;
  
  if (config.exchange === 'bybit') {
    lastPrice = data.lastPrice;
    priceChange = data.price24hPcnt;
  } else {
    lastPrice = data.c;
    priceChange = data.P;
  }
 
   if (lastPrice) {
    charTconfig.priceHistory.push({
    price: lastPrice,
    timestamp: new Date().toLocaleTimeString()
  });
   }
    
  // Сохраняем только последние N точек
  if (charTconfig.priceHistory.length > charTconfig.historySize) {
         charTconfig.priceHistory.shift();
  }

  if (lastPrice) {
    calcPriceRange(lastPrice);
  }

  broadcast({
    type: 'ticker',
    data: {
      lastPrice: lastPrice,
      priceChange: priceChange,
      history: charTconfig.priceHistory
    }
  });
}

let prices = [];

function calcPriceRange(p) {
    prices.length = 0;
    const initialPrice = parseFloat(p); // Начальная цена (число)
     
    let multiplier = -3.0; // Начинаем с -3%

    for (let i = 0; i < 20; i++) {
        // Пересчитываем цену: price ± multiplier%
        const newPrice = initialPrice * (1 + (multiplier / 100));
        
        // Округляем до 2 знаков и сохраняем как число
        prices.push(parseFloat(newPrice.toFixed(2)));
        
        multiplier += 0.3; // Увеличиваем множитель на 0.3% каждый шаг
    }

}

let bidCostSum = []; //Этот массив хранит в себе Bye sum cost 
let askCostSum = []; //Этот массив хранит в себе Sell sum cost 

function fillArr() {
  for(let i = 0; i < 20; i++) {
  askCostSum[i] = 0;
  bidCostSum[i] = 0;
  }
};

fillArr();

setInterval(() => {
 fillArr();
}, 300000) //Обнуление данных некоторый каждый интервал времени

function calcTradesForChart(data) {
       let index;
  
       data.bids.forEach((bid) => {
         index = binarySearch(prices, parseFloat(bid.price));
         bidCostSum[index] += Math.round(parseFloat(bid.amount));
       })

       data.asks.forEach((ask) => {
         index = binarySearch(prices, parseFloat(ask.price));
         askCostSum[index] += Math.round(parseFloat(ask.amount));
       })
}

function binarySearch(arr, target) {
    let left = 0;
    let right = arr.length - 1;
    
    // Бинарный поиск
    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        
        if (arr[mid] === target) {
            return mid; // точное совпадение
        } else if (arr[mid] < target) {
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }
    
    // Если точного совпадения нет, возвращаем ближайший элемент
    // Проверяем границы массива
    if (left >= arr.length) return arr.length - 1; // target больше всех элементов
    if (right < 0) return 0; // target меньше всех элементов
    
    // Выбираем между left и right (которые теперь указывают на соседние элементы)
    return (target - arr[right] <= arr[left] - target) ? right : left;
}

// Расчет разницы стакана
function calculateBookDifference(book) {
  const sumBids = book.bids.reduce((sum, bid) => sum + parseFloat(bid.total), 0);
  const sumAsks = book.asks.reduce((sum, ask) => sum + parseFloat(ask.total), 0);
  
  return (((sumBids / sumAsks) - 1) * 100).toFixed(2);
}

// Обновление соотношения покупок/продаж
function updateRatio() {
  const totalTrades = stats.buyTrades + stats.sellTrades;
  stats.ratio = totalTrades > 0 
    ? Math.round(((stats.buyTrades - stats.sellTrades) / totalTrades) * 100)
    : 0;

  broadcast({
    type: 'tradeStats',
    data: {
      buyTrades: stats.buyTrades,
      sellTrades: stats.sellTrades,
      ratio: stats.ratio
    }
  });

  stats.buyTrades = 0;
  stats.sellTrades = 0;
}

// Отправка данных всем клиентам
function broadcast(message) {
  if (!wss || !wss.clients) return;
  
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// API Endpoints
app.use(express.json());

app.post('/api/config', (req, res) => {
  try {
    const { exchange, symbol, depth, minCost, period } = req.body;
    
    if (exchange) config.exchange = exchange;
    if (symbol) config.symbol = symbol.toUpperCase();
    if (depth) config.orderBookDepth = parseInt(depth);
    if (minCost) config.tradesTracking.minCost = parseFloat(minCost);
    if (period) config.tradesTracking.calculationPeriod = parseInt(period);
    
    // Переподключаемся с новыми параметрами
    initMarketWebSocket();
    
    res.json({ success: true, config });
  } catch (error) {
    console.error('Config error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Запуск серверов
async function startServers() {
  // Проверка портов
  if (!(await checkPort(HTTP_PORT))) {
    console.error(`HTTP порт ${HTTP_PORT} занят!`);
    process.exit(1);
  }

  if (!(await checkPort(WS_PORT))) {
    console.error(`WebSocket порт ${WS_PORT} занят!`);
    process.exit(1);
  }

  // WebSocket сервер
  wss = new WebSocket.Server({ port: WS_PORT });
  console.log(`WebSocket server running on ws://localhost:${WS_PORT}`);

  // HTTP сервер
  app.use(express.static('public'));
  app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));
  
  const httpServer = app.listen(HTTP_PORT, () => {
    console.log(`HTTP server running on http://localhost:${HTTP_PORT}`);
  });

  // Инициализация соединения с биржей
  initMarketWebSocket();

  // Обработка завершения
  process.on('SIGINT', () => {
    console.log('\nЗавершение работы...');
    if (marketWS) marketWS.close();
    if (wss) wss.close();
    httpServer.close();
    process.exit();
  });
}

startServers().catch(console.error);

async function checkPort(port) {
  const net = require('net');
  return new Promise((resolve) => {
    const server = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        server.close();
        resolve(true);
      })
      .listen(port);
  });
}

//Обработчик выбора токена
app.post('/api/set-coin', (req, res) => {
  try {
    const { pair } = req.body;
    
    config.symbol = pair.toUpperCase(); //Меняем симбол
    
    reconnectWS(); //переподключаемся к WS

    console.log('Received filter value:', pair);
    res.json({ success: true, pair });
    
  } catch (error) {
    console.error('pair error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function tradeFilter(value) {
    
        // Преобразуем cost в число, если это строка
        if (typeof value === 'string') {
            parseFloat(value) 
        } 
        //console.log(value, filterValue, typeof value, typeof filterValue);
        // Оставляем только трейды с cost > filterValue
        return value > filterValue;
 
};

app.post('/api/set-bs', (req, res) => {
  try {
    let  interval  = req.body.bsperiod;
    let  minCost  = req.body.MIN_TRACKING_COST;
    
    // Сохраняем фильтр (можно в переменную или БД)
    bsperiod = parseFloat(interval);
    MIN_TRACKING_COST = parseFloat(minCost);
    
    console.log('Received filter value:', filterValue);
    res.json({ success: true, filterValue });
    
  } catch (error) {
    console.error('Filter error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/set-filter', (req, res) => {
  try {
    const { minSize } = req.body;
    
    // Валидация
    if (minSize && isNaN(parseFloat(minSize))) {
      return res.status(400).json({ error: 'Invalid filter value' });
    }
    
    // Сохраняем фильтр (можно в переменную или БД)
    filterValue = minSize ? parseFloat(minSize) : null;

    // Здесь можно добавить сохранение в глобальную переменную или базу данных
    
    console.log('Received filter value:', filterValue);
    res.json({ success: true, filterValue });
    
  } catch (error) {
    console.error('Filter error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

//Расчёты 

// function updateSpeedMetrics() {

//     let totalTrades = buyTrades + sellTrades;
  
//   // Рассчитываем процентное соотношение (-100% до +100%)
//       ratio = totalTrades > 0 
//     ? Math.round(((buyTrades - sellTrades) / totalTrades) * 100)
//     : 0;

//     return ratio;
  
// }
 
  function reconnectWS() {
  marketWS.close();
  
}