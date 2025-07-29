// netlify/functions/get-stock-details.js
const yahooFinance = require('yahoo-finance2').default;

// Configurazione per evitare problemi con cookies in ambiente serverless
const yahooOptions = {
  validateResult: false,
  cookieJar: false,
  timeout: 10000
};

exports.handler = async (event, context) => {
  try {
    const { ticker } = JSON.parse(event.body);
    
    if (!ticker) {
      throw new Error('Ticker non specificato');
    }

    // Prova prima con quote semplice
    let quote, summary, stats;
    
    try {
      quote = await yahooFinance.quote(ticker, yahooOptions);
    } catch (error) {
      console.warn(`Quote failed for ${ticker}, trying quoteSummary:`, error.message);
    }
    
    try {
      summary = await yahooFinance.quoteSummary(ticker, { 
        modules: ['summaryDetail', 'financialData', 'price'] 
      }, yahooOptions);
    } catch (error) {
      console.warn(`Summary failed for ${ticker}:`, error.message);
    }
    
    try {
      stats = await yahooFinance.quoteSummary(ticker, { 
        modules: ['defaultKeyStatistics'] 
      }, yahooOptions);
    } catch (error) {
      console.warn(`Stats failed for ${ticker}:`, error.message);
    }
    
    // Estrai dati da qualsiasi fonte disponibile
    const price = summary?.price || quote;
    const summaryDetail = summary?.summaryDetail;
    const financialData = summary?.financialData;
    const keyStats = stats?.defaultKeyStatistics;
    
    if (!price) {
      throw new Error(`Nessun dato disponibile per ${ticker}`);
    }
    
    const details = {
      symbol: ticker,
      companyName: price.longName || price.shortName || ticker,
      currentPrice: price.regularMarketPrice?.raw || price.regularMarketPrice,
      previousClose: price.regularMarketPreviousClose?.raw || price.regularMarketPreviousClose,
      changePercent: price.regularMarketChangePercent?.raw || 
                    (price.regularMarketPrice && price.regularMarketPreviousClose ? 
                     ((price.regularMarketPrice - price.regularMarketPreviousClose) / price.regularMarketPreviousClose) * 100 : null),
      volume: price.regularMarketVolume?.raw || price.regularMarketVolume || 0,
      avgVolume: price.averageDailyVolume3Month?.raw || price.averageDailyVolume3Month || 0,
      marketCap: price.marketCap?.raw || price.marketCap || 0,
      peRatio: price.trailingPE?.raw || price.trailingPE,
      dividend: price.dividendRate?.raw || price.dividendRate,
      dividendYield: price.dividendYield?.raw || price.dividendYield,
      sector: summaryDetail?.sector,
      industry: summaryDetail?.industry,
      beta: keyStats?.beta?.raw || keyStats?.beta,
      fiftyTwoWeekHigh: price.fiftyTwoWeekHigh?.raw || price.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: price.fiftyTwoWeekLow?.raw || price.fiftyTwoWeekLow,
      recommendation: financialData?.recommendationKey
    };
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ details })
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