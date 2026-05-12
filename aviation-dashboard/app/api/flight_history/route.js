import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// 核心组件：内置航空枢纽时区字典 (UTC 偏移量)
// 用于将各地机场的起降时间精准转换为东八区 (UTC+8) 时间
const TZ_OFFSETS = {
  'SIN': 8, 'HKG': 8, 'KUL': 8, 'BKK': 7,
  'BOM': 5.5, 'DEL': 5.5, 'DXB': 4, 'MCT': 4,
  'DOH': 3, 'BAH': 3, 'KWI': 3, 'IKA': 3.5,
  'TBZ': 3.5, 'LHR': 1 
};

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const ident = searchParams.get('ident');

  if (!ident) {
    return NextResponse.json({ error: 'Missing callsign' }, { status: 400 });
  }

  try {
    const url = `https://www.flightaware.com/live/flight/${ident}/history`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    if (!response.ok) {
      throw new Error(`Data Source Scraper failed with status ${response.status}`);
    }

    const html = await response.text();

    const tableMatch = html.match(/<table[^>]*class=["'][^"']*prettyTable[^"']*["'][^>]*>([\s\S]*?)<\/table>/i);
    if (!tableMatch) {
      return NextResponse.json({ error: 'No history data found on page' }, { status: 404 });
    }

    const tbody = tableMatch[1];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const historyRecords = [];
    let matchRow;

    const stripTags = (str) => str.replace(/<[^>]*>/g, '').trim();

    // 🚨 终极修复：彻底清除乱码 & 自动推算东八区时间的解析引擎
    const parseAndConvertToEast8 = (cellHtml, airportCode) => {
      let text = cellHtml.replace(/<span[^>]*class=["']?tz["']?[^>]*>[\s\S]*?<\/span>/ig, '');
      text = stripTags(text);
      // 解决截图中的 &nbsp; 乱码问题
      text = text.replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();

      let hours = 0, mins = 0, hasTime = false;
      
      const tMatch = text.match(/(\d{1,2}):(\d{2})\s*([ap]m?)/i);
      if (tMatch) {
        hours = parseInt(tMatch[1], 10);
        mins = parseInt(tMatch[2], 10);
        let ampm = tMatch[3].toUpperCase();
        if (ampm.startsWith('P') && hours < 12) hours += 12;
        if (ampm.startsWith('A') && hours === 12) hours = 0;
        hasTime = true;
      } else {
        const tMatch24 = text.match(/(\d{1,2}):(\d{2})/);
        if (tMatch24) {
          hours = parseInt(tMatch24[1], 10);
          mins = parseInt(tMatch24[2], 10);
          hasTime = true;
        }
      }

      if (!hasTime) return text;

      let dayShift = 0;
      const dayMatch = text.match(/\(\+?(-?\d+)\)/);
      if (dayMatch) {
          dayShift = parseInt(dayMatch[1], 10);
      }

      // 自动计算并平移至东八区
      if (TZ_OFFSETS[airportCode] !== undefined) {
        const offsetDiff = 8 - TZ_OFFSETS[airportCode];
        let totalMins = hours * 60 + mins + Math.round(offsetDiff * 60);
        
        while (totalMins >= 24 * 60) {
            totalMins -= 24 * 60;
            dayShift += 1;
        }
        while (totalMins < 0) {
            totalMins += 24 * 60;
            dayShift -= 1;
        }
        
        hours = Math.floor(totalMins / 60);
        mins = totalMins % 60;
      }

      const finalHours = hours.toString().padStart(2, '0');
      const finalMins = mins.toString().padStart(2, '0');
      
      let result = `${finalHours}:${finalMins}`;
      if (dayShift > 0) result += ` (+${dayShift})`;
      else if (dayShift < 0) result += ` (${dayShift})`;

      return result;
    };

    while ((matchRow = rowRegex.exec(tbody)) !== null) {
      const rowHtml = matchRow[1];
      const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let matchCell;
      const cells = [];
      
      while ((matchCell = cellRegex.exec(rowHtml)) !== null) {
        cells.push(matchCell[1]);
      }

      if (cells.length >= 7) {
        try {
          let dateRaw = stripTags(cells[0]);
          let dateVal = dateRaw;
          const d = new Date(dateRaw);
          if (!isNaN(d.getTime())) {
            dateVal = d.toISOString().split('T')[0];
          }

          let aircraft = stripTags(cells[1]);

          const extractIata = (cellHtml) => {
            const aMatch = cellHtml.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
            let text = aMatch ? stripTags(aMatch[1]) : stripTags(cellHtml);
            return text.split('/')[0].trim() || "Unknown";
          };
          let origin = extractIata(cells[2]);
          let destination = extractIata(cells[3]);

          // 将机场代码传入时间转换引擎，获取纯净的东八区时间
          let departure = parseAndConvertToEast8(cells[4], origin);
          let arrival = parseAndConvertToEast8(cells[5], destination);

          let durationRaw = stripTags(cells[6]);
          let duration = durationRaw;
          if (durationRaw.includes(':')) {
            let parts = durationRaw.split(':');
            duration = `${parts[0]}h ${parts[1]}m`;
          }

          historyRecords.push({
            Date: dateVal,
            Aircraft: aircraft,
            Origin: origin,
            Destination: destination,
            Departure: departure,
            Arrival: arrival,
            Duration: duration
          });

          if (historyRecords.length >= 10) break;

        } catch (e) {
          console.warn('解析单行历史记录失败，跳过该行:', e);
          continue;
        }
      }
    }

    const finalData = {
      flight_ident: ident,
      history_records: historyRecords,
      last_updated: new Date().toISOString()
    };

    return NextResponse.json(finalData);

  } catch (error) {
    console.error('抓取历史记录失败:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}