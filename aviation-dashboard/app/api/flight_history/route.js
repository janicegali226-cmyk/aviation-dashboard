import { NextResponse } from 'next/server';

// 强制动态请求，防止返回旧历史缓存
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const ident = searchParams.get('ident');

  if (!ident) {
    return NextResponse.json({ error: 'Missing callsign' }, { status: 400 });
  }

  try {
    // 1. 直接用 Next.js 伪装浏览器去请求 FlightAware 的历史页面
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

    // 2. 轻量级解析引擎：定位历史数据表格 (替代 Python 的 bs4 table.prettyTable)
    const tableMatch = html.match(/<table[^>]*class=["'][^"']*prettyTable[^"']*["'][^>]*>([\s\S]*?)<\/table>/i);
    if (!tableMatch) {
      return NextResponse.json({ error: 'No history data found on page' }, { status: 404 });
    }

    const tbody = tableMatch[1];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const historyRecords = [];
    let matchRow;

    // 辅助函数：去除 HTML 标签，提取纯文本
    const stripTags = (str) => str.replace(/<[^>]*>/g, '').trim();

    // 3. 循环解析每一行 <tr>
    while ((matchRow = rowRegex.exec(tbody)) !== null) {
      const rowHtml = matchRow[1];
      
      // 跳过表头 <th>，只抓取 <td>
      const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let matchCell;
      const cells = [];
      while ((matchCell = cellRegex.exec(rowHtml)) !== null) {
        cells.push(matchCell[1]);
      }

      // 如果列数足够（对应 Python 里的 len(tds) < 7 continue）
      if (cells.length >= 7) {
        try {
          // --- 解析日期 (Date) ---
          let dateRaw = stripTags(cells[0]);
          let dateVal = dateRaw;
          const d = new Date(dateRaw);
          if (!isNaN(d.getTime())) {
            dateVal = d.toISOString().split('T')[0]; // 格式化为 YYYY-MM-DD
          }

          // --- 解析机型 (Aircraft) ---
          let aircraft = stripTags(cells[1]);

          // --- 解析起降机场 (Origin & Destination) ---
          const extractIata = (cellHtml) => {
            const aMatch = cellHtml.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
            let text = aMatch ? stripTags(aMatch[1]) : stripTags(cellHtml);
            return text.split('/')[0].trim() || "Unknown";
          };
          let origin = extractIata(cells[2]);
          let destination = extractIata(cells[3]);

          // --- 解析起降时间 (Departure & Arrival) ---
          const extractTime = (cellHtml) => {
            // 剔除时区 <span> 标签 (替代 Python 的 tz_span.extract())
            let text = cellHtml.replace(/<span[^>]*class=["']?tz["']?[^>]*>[\s\S]*?<\/span>/ig, '');
            text = stripTags(text);
            // 将 08:30PM 转换为 24小时制 20:30
            const tMatch = text.match(/(\d{1,2}):(\d{2})([ap]m?)/i);
            if (tMatch) {
              let hr = parseInt(tMatch[1], 10);
              let min = tMatch[2];
              let ampm = tMatch[3].toUpperCase();
              if (ampm.startsWith('P') && hr < 12) hr += 12;
              if (ampm.startsWith('A') && hr === 12) hr = 0;
              return `${hr.toString().padStart(2, '0')}:${min}`;
            }
            return text;
          };
          let departure = extractTime(cells[4]);
          let arrival = extractTime(cells[5]);

          // --- 解析飞行时长 (Duration) ---
          let durationRaw = stripTags(cells[6]);
          let duration = durationRaw;
          if (durationRaw.includes(':')) {
            let parts = durationRaw.split(':');
            duration = `${parts[0]}h ${parts[1]}m`;
          }

          // 压入结果数组
          historyRecords.push({
            Date: dateVal,
            Aircraft: aircraft,
            Origin: origin,
            Destination: destination,
            Departure: departure,
            Arrival: arrival,
            Duration: duration
          });

          // 严格遵循 Python 版本逻辑，只取前 10 条历史记录
          if (historyRecords.length >= 10) break;

        } catch (e) {
          console.warn('解析单行历史记录失败，跳过该行:', e);
          continue;
        }
      }
    }

    // 4. 打包返回，与原 Python 接口返回格式 100% 对齐
    const finalData = {
      flight_ident: ident,
      history_records: historyRecords,
      last_updated: new Date().toISOString()
    };

    console.log(`🌟 成功抓取航班 ${ident} 的历史记录:`, historyRecords.length, '条');
    return NextResponse.json(finalData);

  } catch (error) {
    console.error('抓取历史记录失败:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}