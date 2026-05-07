import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const ident = searchParams.get('ident');

  if (!ident) return NextResponse.json({ error: 'Missing callsign' }, { status: 400 });

  try {
    const response = await fetch(`http://127.0.0.1:5000/api/flight/${ident}`);
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
        // 1. 机场字段全覆盖
        origin: { code: pythonData.origin_airport || "N/A" },
        destination: { code: pythonData.destination_airport || "N/A" },
        origin_airport: pythonData.origin_airport || "N/A",
        destination_airport: pythonData.destination_airport || "N/A",
        
        // 2. 速度与距离适配 (核心修复)
        speed: pythonData.speed,
        velocity: (pythonData.speed / 3.6), // 🌟 关键：将 KM/H 转回 m/s 适配前端
        distance: pythonData.distance,
        route_distance: pythonData.distance || 0,
        
        // 3. 时间与时长 (核心修复)
        filed_ete: pythonData.duration || 28800, // 🌟 补齐飞行时长
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