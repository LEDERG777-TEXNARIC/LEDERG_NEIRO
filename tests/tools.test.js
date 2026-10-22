import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateExpression,convertUnit,getMoscowTime,detectToolRequest,searchWikipedia,getWikipediaExtract,getWeather} from '../tools.js';
test('calculator handles arithmetic and parentheses without eval',()=>{assert.equal(calculateExpression('(12 + 8) / 4 * 3'),15);assert.equal(calculateExpression('2^3 + 1'),9)});
test('calculator rejects arbitrary code and division by zero',()=>{assert.throws(()=>calculateExpression('globalThis.process.exit()'));assert.throws(()=>calculateExpression('1 / 0'))});
test('unit conversion supports distance and temperature',()=>{assert.equal(convertUnit(10,'км','мили').value,6.21371);assert.equal(convertUnit(10,'км','мили').unit,'миль');assert.equal(convertUnit(0,'c','f').value,32)});
test('Moscow clock uses IANA timezone',()=>{const result=getMoscowTime(new Date('2026-01-01T00:00:00.000Z'));assert.match(result.time,/^03:00/);assert.match(result.date,/2026/);assert.equal(result.timeZone,'Europe/Moscow')});
test('tool detector recognizes time, web search, weather, calculation and conversion',()=>{assert.equal(detectToolRequest('который час по москве').type,'time');assert.equal(detectToolRequest('поищи в интернете квантовые компьютеры').type,'search');assert.equal(detectToolRequest('погода в Берлине').type,'weather');assert.equal(detectToolRequest('посчитай 23 * 5').type,'calculate');assert.deepEqual(detectToolRequest('переведи 10 км в мили'),{type:'convert',value:10,from:'км',to:'мили'})});
test('Wikipedia search sends anonymous CORS parameter and renders safe result URLs',async()=>{let called;const result=await searchWikipedia('нейросеть',{fetchImpl:async(url)=>{called=url;return{ok:true,json:async()=>({query:{search:[{title:'Нейронная сеть',snippet:'<span>Обучение</span> &amp; веса'}]}})}}});assert.equal(called.searchParams.get('origin'),'*');assert.equal(result[0].title,'Нейронная сеть');assert.equal(result[0].snippet,'Обучение & веса');assert.match(result[0].url,/wikipedia\.org\/wiki/)});


test('tool detection supports English web search, weather, math, and conversions', () => {
  assert.deepEqual(detectToolRequest('Search for quantum computers'), { type: 'search', query: 'quantum computers' });
  assert.deepEqual(detectToolRequest('Поищи в интернете квантовые компьютеры'), { type: 'search', query: 'квантовые компьютеры' });
  assert.deepEqual(detectToolRequest('weather in Berlin'), { type: 'weather', query: 'Berlin' });
  assert.deepEqual(detectToolRequest('calculate 23 * 5'), { type: 'calculate', expression: '23 * 5' });
  assert.deepEqual(detectToolRequest('convert 10 km to miles'), { type: 'convert', value: 10, from: 'km', to: 'miles' });
});

test('Wikipedia live search supports user-language editions', async () => {
  let called;
  await searchWikipedia('штучний інтелект', { lang: 'uk', fetchImpl: async (url) => {
    called = url;
    return { ok: true, json: async () => ({ query: { search: [] } }) };
  }});
  assert.equal(called.hostname, 'uk.wikipedia.org');
});


test('article extract API provides readable context with a public CORS request', async () => {
  let called;
  const article = await getWikipediaExtract('Neural network', {
    lang: 'en',
    fetchImpl: async (url) => {
      called = url;
      return {
        ok: true,
        json: async () => ({ query: { pages: { '123': { pageid: 123, title: 'Neural network', extract: 'A neural network is a machine learning model.' } } } })
      };
    }
  });
  assert.equal(called.searchParams.get('origin'), '*');
  assert.equal(called.searchParams.get('prop'), 'extracts');
  assert.equal(article.title, 'Neural network');
  assert.match(article.extract, /machine learning/);
  assert.match(article.url, /en\.wikipedia\.org\/wiki/);
});


test('weather geocoding uses the response language for place names', async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    if (url.hostname === 'geocoding-api.open-meteo.com') {
      return {
        ok: true,
        json: async () => ({ results: [{ name: 'Berlin', country: 'Germany', latitude: 52.52, longitude: 13.405 }] })
      };
    }
    return {
      ok: true,
      json: async () => ({
        timezone: 'Europe/Berlin',
        current: {
          temperature_2m: 18.5, relative_humidity_2m: 50,
          apparent_temperature: 18.2, wind_speed_10m: 9,
          weather_code: 0, time: '2026-10-22T18:00'
        }
      })
    };
  };
  const result = await getWeather('Berlin', { language: 'de', fetchImpl });
  assert.equal(requests[0].searchParams.get('language'), 'de');
  assert.equal(result.city, 'Berlin, Germany');
  assert.equal(result.temperature, 18.5);
});
