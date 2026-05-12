import { NextResponse } from 'next/server';

// 强制实时响应，绝对不准缓存
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const ident = searchParams.get('ident');

  if (!ident) return NextResponse.json({ error: 'Missing callsign' }, { status: 400 });

  try {
    // 1. 🚨 核心改造：直接在 Next.js 里去抓取数据，彻底干掉对 Python 后端的依赖！
    const url = `https://www.flightaware.com/live/flight/${ident}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    if (!response.ok) throw new Error('Data Source Scraper failed');

    const html = await response.text();
    
    // 2. 使用正则提取内置 JSON 数据
    const match = html.match(/trackpollBootstrap\s*=\s*(\{.+?\});\s*<\/script>/s);
    if (!match || !match[1]) throw new Error('No schedule data found on page');

    const rawData = JSON.parse(match[1]);
    const flights = rawData.flights;
    
    if (!flights || Object.keys(flights).length === 0) {
        throw new Error('No active flight data available');
    }

    // 3. 解析核心飞行数据
    const flightId = Object.keys(flights)[0];
    const flight = flights[flightId];
    const flightPlan = flight.flightPlan || {};
    const takeoff = flight.takeoffTimes || {};
    const landing = flight.landingTimes || {};

    let durationSec = flightPlan.ete;
    if (!durationSec) {
        const depTime = takeoff.actual || takeoff.scheduled;
        const arrTime = landing.actual || landing.estimated || landing.scheduled;
        if (depTime && arrTime && arrTime > depTime) {
            durationSec = arrTime - depTime;
        } else {
            durationSec = 28800; // 兜底 8 小时
        }
    }

    // 4. 完全保留你原本的 Unix 转换函数
    const convertUnixToISO = (unixSeconds) => {
      if (!unixSeconds || isNaN(unixSeconds)) return null;
      return new Date(unixSeconds * 1000).toISOString();
    };

    const speedVal = flight.filed_speed || flightPlan.speed || 0;
    const distanceVal = flight.distance_filed || flightPlan.directDistance || 0;

    // 5. 完美复刻你原来的 adaptedData 结构！
    const adaptedData = {
      flights: [{
        ident: ident,
        aircraft_type: flight.aircraftTypeFriendly || (flight.aircraft && flight.aircraft.friendlyType) || "Unknown",
        origin: { code: (flight.origin && flight.origin.iata) || "N/A" },
        destination: { code: (flight.destination && flight.destination.iata) || "N/A" },
        origin_airport: (flight.origin && flight.origin.iata) || "N/A",
        destination_airport: (flight.destination && flight.destination.iata) || "N/A",
        speed: speedVal,
        velocity: (speedVal / 3.6), 
        distance: distanceVal,
        route_distance: distanceVal || 0,
        filed_ete: durationSec || 28800, 
        actual_out: convertUnixToISO(takeoff.actual),
        estimated_in: convertUnixToISO(landing.estimated),
        scheduled_out: convertUnixToISO(takeoff.scheduled),
        scheduled_in: convertUnixToISO(landing.scheduled)
      }]
    };

    console.log("🌟 发往前端的适配数据:", adaptedData);
    return NextResponse.json(adaptedData);

  } catch (error) {
    console.error('API Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}