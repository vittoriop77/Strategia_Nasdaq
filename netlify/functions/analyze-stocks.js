// netlify/functions/analyze-stocks.js
const yahooFinance = require('yahoo-finance2').default;

// Configurazione per evitare problemi con cookies in ambiente serverless
const yahooOptions = {
  validateResult: false,
  cookieJar: false,
  timeout: 10000
};

exports.handler = async (event, context) => {
  try {
    const { tickers } = JSON.parse(event.body);
    
    if (!tickers || !Array.isArray(tickers)) {
      throw new Error('Lista ticker non valida');
    }

    const declinedStocks = [];
    const batchSize = 10; // Processa in batch per evitare rate limiting
    
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
      
      // Piccola pausa tra i batch
      if (i + batchSize < tickers.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
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
    // Usa le opzioni configurate per evitare problemi con cookies
    const quote = await yahooFinance.quote(ticker, yahooOptions);
    
    if (!quote || !quote.regularMarketPrice || !quote.regularMarketPreviousClose) {
      console.warn(`Dati insufficienti per ${ticker}`);
      return null;
    }
    
    const currentPrice = quote.regularMarketPrice;
    const previousClose = quote.regularMarketPreviousClose;
    const changePercent = ((currentPrice - previousClose) / previousClose) * 100;
    
    return {
      symbol: ticker,
      currentPrice: currentPrice,
      previousClose: previousClose,
      changePercent: changePercent,
      volume: quote.regularMarketVolume || 0,
      marketCap: quote.marketCap || 0,
      companyName: quote.longName || quote.shortName || ticker
    };
    
  } catch (error) {
    console.error(`Errore analizzando ${ticker}:`, error.message);
    
    // Fallback: prova con una chiamata più semplice
    try {
      const simpleQuote = await yahooFinance.quoteSummary(ticker, {
        modules: ['price']
      }, yahooOptions);
      
      if (simpleQuote?.price) {
        const price = simpleQuote.price;
        const currentPrice = price.regularMarketPrice?.raw || price.regularMarketPrice;
        const previousClose = price.regularMarketPreviousClose?.raw || price.regularMarketPreviousClose;
        
        if (currentPrice && previousClose) {
          const changePercent = ((currentPrice - previousClose) / previousClose) * 100;
          
          return {
            symbol: ticker,
            currentPrice: currentPrice,
            previousClose: previousClose,
            changePercent: changePercent,
            volume: price.regularMarketVolume?.raw || 0,
            marketCap: price.marketCap?.raw || 0,
            companyName: price.longName || price.shortName || ticker
          };
        }
      }
    } catch (fallbackError) {
      console.error(`Fallback failed for ${ticker}:`, fallbackError.message);
    }
    
    return null;
  }
}
