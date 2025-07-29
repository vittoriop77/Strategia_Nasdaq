// netlify/functions/get-tickers.js
const https = require('https');

exports.handler = async (event, context) => {
  try {
    const csvData = await fetchCSV('https://yfiua.github.io/index-constituents/constituents-nasdaq100.csv');
    const tickers = parseCSV(csvData);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ tickers })
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

function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
  });
}

function parseCSV(csvText) {
  const lines = csvText.split('\n').filter(line => line.trim());
  const tickers = [];
  
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const columns = lines[i].split(',');
    if (columns[0] && columns[0].trim()) {
      tickers.push(columns[0].trim().replace(/"/g, ''));
    }
  }
  
  return tickers;
}