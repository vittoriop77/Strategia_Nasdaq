// netlify/functions/analyze-stocks.js
const yahooFinance = require('yahoo-finance2').default;

// Opzioni da passare a ogni chiamata (importante in ambiente serverless)
const fetchOptions = {
  validateResult: false,
  cookieJar: false,          // fondamentale su Netlify / serverless
  timeout: 15000,            // aumentato un po' per maggiore stabilità
  // Se Yahoo inizia a bloccare richieste, prova ad aggiungere:
  // headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StockAnalyzer/1.0)' }
};

exports.handler = async (event, context) => {
  try {
    // Parsa il body (contiene { tickers: ["AAPL", "MSFT", ...] })
    const { tickers } = JSON.parse(event.body || '{}');
    
    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Lista ticker non valida o vuota' })
      };
    }

    const declinedStocks = [];
    const batchSize = 10; // evita rate limiting / blocchi
    
    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize);
      
      const batchResults = await Promise.allSettled(
        batch.map(ticker => analyzeStock(ticker))
      );
      
      batchResults.forEach((result) => {
        if (result.status === 'fulfilled' && result.value) {
          const stock = result.value;
          if (stock.changePercent < -3) {
            declinedStocks.push(stock);
          }
        }
      });
      
      // Pausa tra un batch e l'altro
      if (i + batchSize < tickers.length) {
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
    }
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify({
        declinedStocks,
        totalAnalyzed: tickers.length,
        declinedCount: declinedStocks.length
      })
    };
    
  } catch (error) {
    console.error('Errore handler principale:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: error.message || 'Errore interno del server' })
    };
  }
};

/**
 * Analizza un singolo ticker
 * @param {string} ticker 
 * @returns {Promise<object|null>}
 */
async function analyzeStock(ticker) {
  try {
    // Tentativo principale: quote completa
    const quote = await yahooFinance.quote(ticker, {}, fetchOptions);
    
    if (!quote?.regularMarketPrice || !quote?.regularMarketPreviousClose) {
      console.warn(`Dati di mercato insufficienti per ${ticker}`);
      return null;
    }
    
    const currentPrice = quote.regularMarketPrice;
    const previousClose = quote.regularMarketPreviousClose;
    const changePercent = ((currentPrice - previousClose) / previousClose) * 100;
    
    return {
      symbol: ticker.toUpperCase(),
      currentPrice: Number(currentPrice.toFixed(2)),
      previousClose: Number(previousClose.toFixed(2)),
      changePercent: Number(changePercent.toFixed(2)),
      volume: quote.regularMarketVolume || 0,
      marketCap: quote.marketCap || 0,
      companyName: quote.longName || quote.shortName || ticker
    };
    
  } catch (error) {
    console.error(`Errore primario per ${ticker}: ${error.message}`);
    
    // Fallback: solo modulo price
    try {
      const summary = await yahooFinance.quoteSummary(
        ticker,
        { modules: ['price'] },
        fetchOptions
      );
      
      const price = summary?.price;
      if (!price) return null;
      
      const currentPrice = price.regularMarketPrice?.raw ?? price.regularMarketPrice;
      const previousClose = price.regularMarketPreviousClose?.raw ?? price.regularMarketPreviousClose;
      
      if (typeof currentPrice !== 'number' || typeof previousClose !== 'number') {
        return null;
      }
      
      const changePercent = ((currentPrice - previousClose) / previousClose) * 100;
      
      return {
        symbol: ticker.toUpperCase(),
        currentPrice: Number(currentPrice.toFixed(2)),
        previousClose: Number(previousClose.toFixed(2)),
        changePercent: Number(changePercent.toFixed(2)),
        volume: price.regularMarketVolume?.raw ?? 0,
        marketCap: price.marketCap?.raw ?? 0,
        companyName: price.longName || price.shortName || ticker
      };
    } catch (fallbackError) {
      console.error(`Fallback fallito per ${ticker}: ${fallbackError.message}`);
      return null;
    }
  }
}