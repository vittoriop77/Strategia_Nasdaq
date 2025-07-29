// netlify/functions/analyze-atr.js
const yahooFinance = require('yahoo-finance2').default;

// Configurazione per evitare problemi con cookies in ambiente serverless
const yahooOptions = {
  validateResult: false,
  cookieJar: false,
  timeout: 15000
};

exports.handler = async (event, context) => {
  try {
    const { stocks, atrThreshold = 0.03 } = JSON.parse(event.body);
    
    if (!stocks || !Array.isArray(stocks)) {
      throw new Error('Lista stocks non valida');
    }

    console.log(`Iniziando analisi ATR per ${stocks.length} ticker con soglia ${atrThreshold}`);
    
    const atrResults = [];
    const batchSize = 5; // Processa in batch più piccoli per ATR
    
    for (let i = 0; i < stocks.length; i += batchSize) {
      const batch = stocks.slice(i, i + batchSize);
      const batchPromises = batch.map(stock => calculateATR(stock, atrThreshold));
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          atrResults.push(result.value);
        } else {
          console.warn(`ATR calculation failed for ${batch[index]?.symbol}:`, result.reason?.message);
        }
      });
      
      // Pausa più lunga tra i batch per ATR (richiede più dati)
      if (i + batchSize < stocks.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    const filteredByATR = atrResults.filter(stock => stock.atr > atrThreshold);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        allATRAnalysis: atrResults,
        filteredByATR: filteredByATR,
        filteredCount: filteredByATR.length,
        totalAnalyzed: atrResults.length,
        atrThreshold: atrThreshold
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

async function calculateATR(stock, threshold) {
  try {
    const ticker = stock.symbol;
    console.log(`Calculating ATR for ${ticker}...`);
    
    // Ottieni dati degli ultimi 10 giorni per sicurezza (per avere almeno 6 giorni lavorativi)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 15);
    
    const history = await yahooFinance.historical(ticker, {
      period1: startDate,
      period2: endDate,
      interval: '1d'
    }, yahooOptions);
    
    if (!history || history.length < 6) {
      console.warn(`Dati insufficienti per ATR di ${ticker}: ${history?.length || 0} giorni`);
      return null;
    }
    
    // Prendi gli ultimi 6 giorni di dati validi
    const validData = history
      .filter(day => day.high && day.low && day.close && 
                    day.high > 0 && day.low > 0 && day.close > 0)
      .slice(-6);
    
    if (validData.length < 6) {
      console.warn(`Dati validi insufficienti per ATR di ${ticker}: ${validData.length} giorni`);
      return null;
    }
    
    // Calcola True Range per ciascun giorno (tranne il primo)
    const trueRanges = [];
    
    for (let i = 1; i < validData.length; i++) {
      const current = validData[i];
      const previous = validData[i - 1];
      
      // TR = max(High - Low, |High - Previous Close|, |Low - Previous Close|)
      const tr1 = current.high - current.low;
      const tr2 = Math.abs(current.high - previous.close);
      const tr3 = Math.abs(current.low - previous.close);
      
      const trueRange = Math.max(tr1, tr2, tr3);
      trueRanges.push(trueRange);
    }
    
    // ATR = media degli ultimi 5 True Range
    const atr5 = trueRanges.slice(-5).reduce((sum, tr) => sum + tr, 0) / Math.min(5, trueRanges.length);
    
    // Calcola ATR percentuale rispetto al prezzo corrente
    const currentPrice = stock.currentPrice || validData[validData.length - 1].close;
    const atrPercent = atr5 / currentPrice;
    
    console.log(`${ticker}: ATR=${atr5.toFixed(4)}, ATR%=${(atrPercent * 100).toFixed(2)}%, Threshold=${(threshold * 100).toFixed(1)}%`);
    
    return {
      ...stock,
      atr: atrPercent,
      atrAbsolute: atr5,
      atrPercent: atrPercent * 100,
      meetsATRThreshold: atrPercent > threshold,
      dataPoints: trueRanges.length,
      analysisDate: new Date().toISOString()
    };
    
  } catch (error) {
    console.error(`Errore calcolando ATR per ${stock.symbol}:`, error.message);
    return null;
  }
}