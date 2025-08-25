const bidsContainer = document.getElementById('bids');
const asksContainer = document.getElementById('asks');
const tickTime = document.getElementById('tickTime');

const buySpeed = document.getElementById('buySpeed');
const sellSpeed = document.getElementById('sellSpeed');
const ratioElement = document.getElementById('tradeRatio');

let timer = 0;

let orderBookUpdateCount = 0;
let tradeUpdateCount = 0;
 
let lastSpeedCalculationTime2 = Date.now(); //для вычисления скорости
 
const speedPeriod = 1000; //за какой период считается скорость рынка
 
let buyTrades = 0;
let sellTrades = 0;
let ratio = 0;

 let buyCount = 0;
 let sellCount = 0;

const maxTrades = 15;

function updateSpeedMetrics() {

   buySpeed.textContent = buyTrades;
   sellSpeed.textContent = sellTrades;

  ratioElement.textContent = ratio;
  ratioElement.style.color = ratio > 0 ? '#4CAF50' : ratio < 0 ? '#F44336' : '#666';
 
}

    document.addEventListener('DOMContentLoaded', () => {
    
      // Элементы DOM
      const currentPriceElement = document.getElementById('currentPrice');
      const tradesContainer = document.getElementById('trades');

      //Filter trades
      document.getElementById('filterForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const minSize = formData.get('minSize');
    
    try {
      const response = await fetch('/api/set-filter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ minSize })
      });
      
      const result = await response.json();
      console.log('Server response:', result);
    
      //await loadTrades();
    } catch (error) {
      console.error('Error:', error);
    }
    });

    //speed s/d form 
    document.getElementById('bsParamsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      let timePeriod = formData.get('bsperiod');
      let bsprice = formData.get('bsprice');

      console.log(typeof parseFloat(timePeriod));
      
      if (timePeriod) {
          bsperiod = parseFloat(timePeriod) * 1000;
      } else {
         bsperiod = 5000;
      }
      if (bsprice) {
         MIN_TRACKING_COST = parseFloat(bsprice);
      } else {
        MIN_TRACKING_COST = 50;
      }

      try {
      const response = await fetch('/api/set-bs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ bsperiod, MIN_TRACKING_COST})
      });
      
      const result = await response.json();
      console.log('Server response:', result);
    
      //await loadTrades();
    } catch (error) {
      console.error('Error:', error);
    }

    });

    document.getElementById('coinForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      let pair = formData.get('pair');

      symbolDisplay.innerText = pair;

      if (pair) {
        try {
      const response = await fetch('/api/set-coin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ pair })
      });
      
      const result = await response.json();
      console.log('Server response (pair set):', result);
    
    } catch (error) {
      console.error('Error:', error);
        }
      }
    });

      //стакан

      let lastPrice = 0;

      // Подключение к WebSocket
      let ws;
      try {
        ws = new WebSocket('ws://localhost:8081');
      } catch (error) {
        console.error('WebSocket connection error:', error);
        showError('WebSocket connection failed. Please refresh the page.');
        return;
      }

      ws.onopen = () => console.log('Connected to WebSocket server');

  //Обработка сообщений с сервера
  
      ws.onmessage = (event) => {
    try {
    const message = JSON.parse(event.data);
    //const now = Date.now();

    // switch (message.type) {
    //   case "orderBook": {
    //     break;
    //   } 
    // }
 
    if (message.type === 'orderBook') {
      //Обработчик стакана
      orderBookUpdateCount += 1;
      updateOrderBook(message.data);
 
      lastOrderBookData = message.data;
    
      updateCurrentDiff(parseFloat(message.percent)); //Разница в стакане
  
    
    } else if (message.type === "tradeStats" ) {
        buyTrades = message.data.buyTrades;
        sellTrades = message.data.sellTrades;
        ratio = message.data.ratio;
        updateSpeedMetrics();
      
    } else if (message.type === "trade") {
   
      //События куплепродажи
      addTradeToDOM(message.data);
       
      
    } else if (message.type === "bsCount") {
       //Счётчик ленты
       buyTrades = message.buyTrades;
       sellTrades = message.sellTrades;
       ratio = message.ratio;

    } else if (message.type === "ticker") {
      //Получение цены: 
      updateCurrentPrice(message.data.lastPrice);
    } else if (message.type === "chart4orders") {

        calcPriceRange(message.data);
        
    }
    
      } catch (error) {
    console.error('Message processing error:', error);
      }
    };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        showError('WebSocket connection error. Trying to reconnect...');
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        showError('Disconnected from server. Refresh page to reconnect.');
      };

      function addTradeToDOM(trade) {
 
         
        if (!tradesContainer) return;
        const tradeElement = document.createElement('div');
        tradeElement.className = `trade ${trade.side}`;
        tradeElement.innerHTML = `
          <span class="time">${trade.time}</span>
          <span class="price">${trade.price}</span>
          <span class="amount">${trade.amount}</span>
          <span class="cost">${trade.cost}</span>
          <span class="side">${trade.side.toUpperCase()}</span>
        `;
        
        tradesContainer.prepend(tradeElement);
        
        if (tradesContainer.children.length > maxTrades) {
          tradesContainer.removeChild(tradesContainer.lastChild);
        }
      }


     function updateOrderBook(data) {
    if (!data || !data.bids || !data.asks) return;

    const targetMinAmount = parseFloat(document.getElementById('minAmountFilter').value) || 10000000;
   
    // Обновляем биды (покупки)
    bidsContainer.innerHTML = '';
    data.bids.forEach(bid => {
        const total = parseFloat(bid.total);

        const highlightClass = total >= targetMinAmount ? 'highlight-buy' : '';
        
        // // Считаем ордера с суммой выше указанной
        // if (total >= targetMinAmount) {
        //     buyCount++;
        // }

        const bidElement = document.createElement('div');
        bidElement.className = `trade buy ${highlightClass}`;
        bidElement.innerHTML = `
            <span class="price">${bid.price}</span>
            <span class="amount">${bid.amount}</span>
            <span class="cost">${formatLargeNumber(total)}</span>
            ${total >= targetMinAmount ? '<span class="matched-badge">★</span>' : ''}
        `;
        bidsContainer.appendChild(bidElement);
    });

    // Обновляем аски (продажи)
    asksContainer.innerHTML = '';
    data.asks.forEach(ask => {
        const total = parseFloat(ask.total);
      
        const highlightClass = total >= targetMinAmount ? 'highlight-sell' : '';
        
        // Считаем ордера с суммой выше указанной
        // if (total >= targetMinAmount) {
        //     sellCount++;
        // }

        const askElement = document.createElement('div');
        askElement.className = `trade sell ${highlightClass}`;
        askElement.innerHTML = `
            <span class="price">${ask.price}</span>
            <span class="amount">${ask.amount}</span>
            <span class="cost">${formatLargeNumber(total)}</span>
            ${total >= targetMinAmount ? '<span class="matched-badge">★</span>' : ''}
        `;
        asksContainer.appendChild(askElement);
    });
}

let lastOrderBookData = null;

document.getElementById('minAmountFilter').addEventListener('input', function() {
    if (lastOrderBookData) {
        updateOrderBook(lastOrderBookData);
    }
});

// Функция для форматирования больших чисел (добавляет разделители)
function formatLargeNumber(num) {
    return num.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

      function updateCurrentPrice(price) {
        if (isNaN(price)) return;
        
        lastPrice = price;
        currentPriceElement.textContent = price.slice(0, 8);
        
        // Анимация изменения цены
        currentPriceElement.style.transition = 'color 0.3s ease';
        currentPriceElement.style.color = price > lastPrice ? '#4CAF50' : '#F44336';
        
        setTimeout(() => {
          currentPriceElement.style.color = '#4CAF50';
        }, 300);
      }

      function showError(message) {
        const errorElement = document.createElement('div');
        errorElement.style.color = '#F44336';
        errorElement.style.textAlign = 'center';
        errorElement.style.padding = '10px';
        errorElement.textContent = message;
        document.querySelector('.container').prepend(errorElement);
      }
 
    });

    //Order 
   const currentOrderElement = document.getElementById('currentOrder');

   function updateCurrentDiff(value) {
  if (!currentOrderElement || isNaN(value)) return;
  
  currentOrderElement.textContent = value.toFixed(1) + '%';
  
  // Анимация изменения
  currentOrderElement.style.transition = 'color 0.3s ease';
  currentOrderElement.style.color = value > 0 ? '#4CAF50' : '#F44336';
  
  setTimeout(() => {
    currentOrderElement.style.color = '#333'; // Возвращаем к стандартному цвету
  }, 300);
}

//Таймер для расчта B/S


function increseTimer () {
 
  tickTime.textContent = "Timer: " + timer;
 
  tickTime.style.color = "#28b9ccff";
 
}

//setInterval(increseTimer, 100);

//----------------------------------------
//----------------------------------------
//----------ГРАФИК------------------------
//----------------------------------------
//----------------------------------------
//График содержит по Y цену +3...-3% от текущей цены с шагом 0.3 %. 
//На ценовых интервалах указаны объемы закупок из стакана с учетом шага изменения цен. То есть диапазон +-0.3 включается в шаг
//Объемы указаны для закупок и для продаж 

let priceIntervals = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
let prevPrice = 0;
const step = 0.01; // Порог изменения цены для перерисовки

// Функция для обновления графика
function calcPriceRange(data) {
  priceIntervals = data.prices;   
  priceChart.data.labels = priceIntervals;

  priceChart.data.datasets[0].data = data.bidCostSum;
  priceChart.data.datasets[1].data = data.askCostSum;

  priceChart.data.datasets[1].data = priceChart.data.datasets[1].data.map(i => i *= -1);

  priceChart.update();

  console.log(priceChart.data);
}
   
// Данные для стакана (биды/аски)
const orderBookData = {
  bids: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // Объемы покупок
  asks: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], // Объемы продаж
};

// Данные для сделок (покупки/продажи)
const tradesData = {
  buys: [10, 20, 40, 80, 160, 10, 10], // Объемы покупок
  sells: [-10, -20, 30, -40, -50, -10, -10], // Объемы продаж
};

// Данные для графика
const chartData = {
  labels: priceIntervals,
  datasets: [
    // Левая панель: глубина стакана (биды - зеленый)
    {
      label: 'Bids (Покупки)',
      data: orderBookData.bids,
      backgroundColor: 'rgba(75, 192, 192, 0.6)',
      borderColor: 'rgba(75, 192, 192, 1)',
      borderWidth: 1,
      yAxisID: 'y',
      xAxisID: 'x1',
    },
    // Левая панель: глубина стакана (аски - красный)
    {
      label: 'Asks (Продажи)',
      data: orderBookData.asks,
      backgroundColor: 'rgba(255, 99, 132, 0.6)',
      borderColor: 'rgba(255, 99, 132, 1)',
      borderWidth: 1,
      yAxisID: 'y',
      xAxisID: 'x1',
    },
    // Правая панель: сделки (покупки - синий)
    // {
    //   label: 'Buy Trades',
    //   data: tradesData.buys,
    //   backgroundColor: 'rgba(54, 162, 235, 0.6)',
    //   borderColor: 'rgba(54, 162, 235, 1)',
    //   borderWidth: 1,
    //   yAxisID: 'y',
    //   xAxisID: 'x2',
    // },
    // // Правая панель: сделки (продажи - оранжевый)
    // {
    //   label: 'Sell Trades',
    //   data: tradesData.sells,
    //   backgroundColor: 'rgba(255, 159, 64, 0.6)',
    //   borderColor: 'rgba(255, 159, 64, 1)',
    //   borderWidth: 1,
    //   yAxisID: 'y',
    //   xAxisID: 'x2',
    // },
  ],
};

// Конфигурация графика
const config = {
  type: 'bar',
  data: chartData,
  options: {
    indexAxis: 'y', // Горизонтальные бары
    responsive: true,
    scales: {
      y: {
        position: 'left',
        title: {
          display: true,
          text: 'Цена (USDT)',
        },
        ticks: {
          callback: (value) => `${value}`, // Формат цены
        },
      },
      x1: {
        position: 'top',
        title: {
          display: true,
          text: 'Глубина стакана',
        },
        grid: {
          drawOnChartArea: false,
        },
      },
      x2: {
        position: 'bottom',
        title: {
          display: true,
          text: 'Объем сделок',
        },
        grid: {
          drawOnChartArea: false,
        },
      },
    },
    plugins: {
      tooltip: {
        callbacks: {
          label: (context) => {
            const label = context.dataset.label || '';
            return `${label}: ${context.raw}`;
          },
        },
      },
    },
  },
};

// Создание графика

let ctx;
let priceChart;

document.addEventListener('DOMContentLoaded', () => {
  ctx = document.getElementById('priceChart').getContext('2d');
  priceChart = new Chart(ctx, config);
  initChart(initialData); //Инициализация графика цены
});
 



//График цен
 // Инициализация WebSocket соединения
    const ws = new WebSocket(`ws://localhost:${window.location.port === '3000' ? '8081' : window.location.port}`);
    
    // Элементы DOM
    const priceDisplay = document.getElementById('priceDisplay');
    const symbolDisplay = document.getElementById('symbol');
    
    // Инициализация графика
    const ctx2 = document.getElementById('priceChart2').getContext('2d');
    let priceCChart;
    let lastPrice = 0;
    let initialData = [{ 
      timestamp: [10],
      price: [20]
    },
      { 
      timestamp: [10],
      price: [20]
    }];
  
    
    // Цвета для графика
    const chartColors = {
      border: 'rgba(75, 192, 192, 1)',
      background: 'rgba(75, 192, 192, 0.2)',
      point: 'rgba(75, 192, 192, 1)',
      currentPrice: 'rgba(255, 99, 132, 1)'
    };
    
    // Загрузка начальных данных
    
    
    // Инициализация графика
    function initChart(initialData) {
      console.log("Chart initiation");
      const labels = initialData.map(item => item.timestamp);
      const data = initialData.map(item => item.price);
      
      priceCChart = new Chart(ctx2, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: 'Price (USDT)',
            data: data,
            borderColor: chartColors.border,
            backgroundColor: chartColors.background,
            borderWidth: 2,
            pointRadius: 2,
            pointBackgroundColor: chartColors.point,
            fill: true,
            tension: 0.1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: false,
              ticks: {
                callback: function(value) {
                  return '$' + value.toLocaleString();
                }
              }
            },
            x: {
              ticks: {
                maxRotation: 45,
                minRotation: 45
              }
            }
          },
          plugins: {
            tooltip: {
              callbacks: {
                label: function(context) {
                  return 'Price: $' + context.parsed.y.toLocaleString();
                }
              }
            }
          }
        }
      });
      
      if (data.length > 0) {
        lastPrice = data[data.length - 1];
        updatePriceDisplay(lastPrice);
      }

      console.log(priceCChart);
    }
    
    // Обработка сообщений WebSocket
    ws.onmessage = function(event) {
      const message = JSON.parse(event.data);
      
      if (message.type === 'ticker') {
        const newPrice = message.data.lastPrice;
        
        // Обновление отображения цены
        if(newPrice) {
          updatePriceDisplay(newPrice);
        }
        
        // Обновление графика
     
        if (message.data.history) {    
            updateChart(message.data.history);
        }
       
        lastPrice = newPrice;
      }
    };
    
    // Обновление отображения цены
    function updatePriceDisplay(price) {
      priceDisplay.textContent = `$${parseFloat(price).toFixed(2)}`;
      
      // Изменение цвета в зависимости от движения цены
      if (price > lastPrice) {
        priceDisplay.className = 'price-display price-up';
      } else if (price < lastPrice) {
        priceDisplay.className = 'price-display price-down';
      } else {
        priceDisplay.className = 'price-display';
      }
    }
    
    // Обновление графика
    function updateChart(history) {
     
      const labels = history.map(item => item.timestamp);
      const data = history.map(item => item.price);

      priceCChart.data.labels = labels;
      priceCChart.data.datasets[0].data = data;
      priceCChart.update();

      history.length = 0;
    }
    
    // Обработка ошибок
    ws.onerror = function(error) {
      console.error('WebSocket Error:', error);
      priceDisplay.textContent = 'Connection error';
    };
    
    ws.onclose = function() {
      console.log('WebSocket disconnected');
      priceDisplay.textContent = 'Disconnected. Reconnecting...';
      setTimeout(() => window.location.reload(), 5000);
    };

