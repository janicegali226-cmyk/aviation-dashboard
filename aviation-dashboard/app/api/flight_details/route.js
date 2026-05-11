import { NextResponse } from 'next/server';

export async function GET(request) {
  // 1. 提取 searchParams 和 origin（origin 就是动态的当前域名，无论是 localhost 还是 Vercel 域名都能自适应）
  const { searchParams, origin } = new URL(request.url);
  const ident = searchParams.get('ident');

  if (!ident) return NextResponse.json({ error: 'Missing callsign' }, { status: 400 });

  try {
    // 2. 🚨 核心修复：用 origin 替换掉 127.0.0.1:5000
    const response = await fetch(`${origin}/api/flight/${ident}`);
    
    if (!response.ok) throw new Error('Python Backend Scraper failed');
    
    const pythonData = await response.json(); 
    console.log("🌟 发往前端的适配数据:", pythonData);

    const convertUnixToISO = (unixSeconds) => {
      if (!unixSeconds || isNaN(unixSeconds)) return null;
      return new Date(unixSeconds * 1000).toISOString();
    };

    const adaptedData = {
      flights: [{
        ident: pythonData.flight_ident || ident,
        aircraft_type: pythonData.aircraft_type || "Unknown",
        origin: { code: pythonData.origin_airport || "N/A" },
        destination: { code: pythonData.destination_airport || "N/A" },
        origin_airport: pythonData.origin_airport || "N/A",
        destination_airport: pythonData.destination_airport || "N/A",
        speed: pythonData.speed,
        velocity: (pythonData.speed / 3.6), 
        distance: pythonData.distance,
        route_distance: pythonData.distance || 0,
        filed_ete: pythonData.duration || 28800, 
        actual_out: convertUnixToISO(pythonData.departure_actual),
        estimated_in: convertUnixToISO(pythonData.arrival_estimated),
        scheduled_out: convertUnixToISO(pythonData.departure_actual),
        scheduled_in: convertUnixToISO(pythonData.arrival_estimated)
      }]
    };

    return NextResponse.json(adaptedData);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}