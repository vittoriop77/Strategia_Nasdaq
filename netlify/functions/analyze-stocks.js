// netlify/functions/analyze-stocks.js
const yahooFinance = require('yahoo-finance2').default;

// Sopprime i warning di validazione
yahooFinance.setGlobalConfig({
  validation: { logErrors: false, logWarnings: false },
  queue: { concurrency: 1, timeout: 15000 }
});

exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }

  try {
    const { tickers } = JSON.parse(event.body);

    if (!tickers || !Array.isArray(tickers)) {
      throw new Error('Lista ticker non valida');
    }

    const declinedStocks = [];
    const batchSize = 5; // batch più piccoli

    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize);

      // Seriale invece di parallelo per evitare rate limiting
      for (const ticker of batch) {
        const stock = await analyzeStock(ticker);
        if (stock && stock.changePercent < -3) {
          declinedStocks.push(stock);
        }
        // Delay tra ogni singola chiamata
        await sleep(500);
      }

      // Delay più lungo tra batch
      if (i + batchSize < tickers.length) {
        await sleep(2000);
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      body: JSON.stringify({
        declinedStocks,
        totalAnalyzed: tickers.length,
        declinedCount: declinedStocks.length
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      body: JSON.stringify({ error: error.message })
    };
  }
};

async function analyzeStock(ticker, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const quote = await yahooFinance.quote(ticker, {}, {
        validateResult: false
      });

      if (!quote?.regularMarketPrice || !quote?.regularMarketPreviousClose) {
        console.warn(`Dati insufficienti per ${ticker}`);
        return null;
      }

      const currentPrice = quote.regularMarketPrice;
      const previousClose = quote.regularMarketPreviousClose;
      const changePercent = ((currentPrice - previousClose) / previousClose) * 100;

      return {
        symbol: ticker,
        currentPrice,
        previousClose,
        changePercent,
        volume: quote.regularMarketVolume || 0,
        marketCap: quote.marketCap || 0,
        companyName: quote.longName || quote.shortName || ticker
      };

    } catch (error) {
      const isTooManyRequests = error.message?.includes('Too Many Requests') || 
                                 error.message?.includes('429');

      console.warn(`Tentativo ${attempt}/${retries} fallito per ${ticker}: ${error.message}`);

      if (isTooManyRequests && attempt < retries) {
        // Backoff esponenziale: 2s, 4s, 8s
        await sleep(2000 * Math.pow(2, attempt - 1));
        continue;
      }

      return null;
    }
  }

  return null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*' };
}
