// netlify/functions/analyze-stocks.js
const { create } = require('yahoo-finance2').default;

// Crea un'istanza con le tue opzioni (lo fai una volta sola)
const yahooFinance = create({
  validateResult: false,
  cookieJar: false,       // molto importante in ambiente serverless
  timeout: 10000
});

exports.handler = async (event, context) => {
  try {
    const { tickers } = JSON.parse(event.body);
    
    if (!tickers || !Array.isArray(tickers)) {
      throw new Error('Lista ticker non valida');
    }

    const declinedStocks = [];
    const batchSize = 10;
    
    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(ticker => analyzeStock(ticker))
      );
      
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          const stock = result.value;
          if (stock.changePercent < -3) {
            declinedStocks.push(stock);
          }
        }
      });
      
      if (i + batchSize < tickers.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        declinedStocks,
        totalAnalyzed: tickers.length,
        declinedCount: declinedStocks.length
      })
    };
    
  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: error.message })
    };
  }
};

async function analyzeStock(ticker) {
  try {
    const quote = await yahooFinance.quote(ticker);
    
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
    console.error(`Errore analizzando ${ticker}:`, error.message);
    
    // Fallback opzionale (puoi anche toglierlo se non serve)
    try {
      const simple = await yahooFinance.quoteSummary(ticker, { modules: ['price'] });
      const price = simple?.price;
      if (!price) return null;

      const currentPrice = price.regularMarketPrice?.raw ?? price.regularMarketPrice;
      const previousClose = price.regularMarketPreviousClose?.raw ?? price.regularMarketPreviousClose;
      
      if (!currentPrice || !previousClose) return null;
      
      const changePercent = ((currentPrice - previousClose) / previousClose) * 100;
      
      return {
        symbol: ticker,
        currentPrice,
        previousClose,
        changePercent,
        volume: price.regularMarketVolume?.raw ?? 0,
        marketCap: price.marketCap?.raw ?? 0,
        companyName: price.longName || price.shortName || ticker
      };
    } catch (fbError) {
      console.error(`Fallback fallito per ${ticker}:`, fbError.message);
      return null;
    }
  }
}