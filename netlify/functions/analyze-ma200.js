// netlify/functions/analyze-ma200.js
const yahooFinance = require('yahoo-finance2').default;

// Configurazione per evitare problemi con cookies in ambiente serverless
const yahooOptions = {
  validateResult: false,
  cookieJar: false,
  timeout: 15000
};

exports.handler = async (event, context) => {
  try {
    const { stocks } = JSON.parse(event.body);
    
    if (!stocks || !Array.isArray(stocks)) {
      throw new Error('Lista stocks non valida');
    }

    const ma200Analysis = [];
    
    for (const stock of stocks) {
      try {
        const ma200Data = await calculateMA200(stock.symbol);
        if (ma200Data) {
          ma200Analysis.push({
            ...stock,
            ma200: ma200Data.ma200,
            isAboveMA200: stock.currentPrice > ma200Data.ma200,
            percentAboveMA200: ((stock.currentPrice - ma200Data.ma200) / ma200Data.ma200) * 100,
            ma200Trend: ma200Data.trend
          });
        }
      } catch (error) {
        console.error(`Errore MA200 per ${stock.symbol}:`, error.message);
      }
      
      // Pausa per evitare rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    const aboveMA200 = ma200Analysis.filter(stock => stock.isAboveMA200);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        allAnalysis: ma200Analysis,
        aboveMA200: aboveMA200,
        aboveMA200Count: aboveMA200.length,
        totalAnalyzed: ma200Analysis.length
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

async function calculateMA200(ticker) {
  try {
    // Ottieni dati storici per 250 giorni (circa 200 giorni lavorativi)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 300); // 300 giorni per sicurezza
    
    const history = await yahooFinance.historical(ticker, {
      period1: startDate,
      period2: endDate,
      interval: '1d'
    }, yahooOptions);
    
    if (!history || history.length < 150) {
      console.warn(`Dati storici insufficienti per MA200 di ${ticker} (solo ${history?.length || 0} giorni)`);
      
      // Fallback: prova con un periodo più corto
      try {
        const shortStartDate = new Date();
        shortStartDate.setDate(shortStartDate.getDate() - 200);
        
        const shortHistory = await yahooFinance.historical(ticker, {
          period1: shortStartDate,
          period2: endDate,
          interval: '1d'
        }, yahooOptions);
        
        if (shortHistory && shortHistory.length >= 100) {
          const closes = shortHistory.map(day => day.close).filter(price => price && !isNaN(price));
          const ma = closes.reduce((sum, price) => sum + price, 0) / closes.length;
		  
          return {
            ma200: ma,
            trend: 'neutrale',
            dataPoints: closes.length,
            note: `MA${closes.length} (dati limitati)`
          };
        }
      } catch (fallbackError) {
        console.error(`Fallback MA200 failed for ${ticker}:`, fallbackError.message);
      }
      
      return null;
    }
    
    // Filtra valori validi e prendi gli ultimi 200
    const validCloses = history
      .map(day => day.close)
      .filter(price => price && !isNaN(price) && price > 0);
    
    if (validCloses.length < 100) {
      console.warn(`Troppo pochi dati validi per ${ticker}: ${validCloses.length}`);
      return null;
    }
    
    const last200 = validCloses.slice(-Math.min(200, validCloses.length));
    const ma200 = last200.reduce((sum, price) => sum + price, 0) / last200.length;
    
    // Calcola trend della MA200 confrontando con 20 giorni fa
    let trend = 'neutrale';
    if (validCloses.length >= 220) {
      const previous200 = validCloses.slice(-220, -20);
      const previousMA200 = previous200.reduce((sum, price) => sum + price, 0) / previous200.length;
      
      const trendPercent = ((ma200 - previousMA200) / previousMA200) * 100;
	  console.error(`MA for ${ticker}:`, trendPercent); //DEBUG DI VITTO
      
      if (trendPercent > 2) trend = 'rialzista';
      else if (trendPercent < -2) trend = 'ribassista';
    }
    
    return {
      ma200: ma200,
      trend: trend,
      dataPoints: last200.length,
      note: last200.length < 200 ? `MA${last200.length}` : 'MA200'
    };
    
  } catch (error) {
    console.error(`Errore calcolando MA200 per ${ticker}:`, error.message);
    return null;
  }
}
