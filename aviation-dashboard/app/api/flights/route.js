import mysql from 'mysql2/promise';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const connection = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: 'ljn200326', // 你的数据库密码
      database: 'aviation_dashboard',
    });

    // 核心修改：将时间窗口从 24 HOUR 极大地缩小到 35 MINUTE
    // 逻辑：找出过去 35 分钟内更新过位置的飞机（即当前正在活跃飞行的），并提取它们的最新坐标
    const query = `
      SELECT t1.icao24, t1.callsign, t1.latitude, t1.longitude, t1.velocity, t1.true_track, t1.captured_at
      FROM flight_data t1
      INNER JOIN (
        SELECT icao24, MAX(captured_at) as max_time
        FROM flight_data
        WHERE captured_at >= NOW() - INTERVAL 1 HOUR
        GROUP BY icao24
      ) t2 ON t1.icao24 = t2.icao24 AND t1.captured_at = t2.max_time;
    `;

    const [rows] = await connection.execute(query);
    await connection.end();

    return NextResponse.json(rows);
  } catch (error) {
    console.error('数据库请求失败:', error);
    return NextResponse.json({ error: 'Failed to fetch flight data' }, { status: 500 });
  }
}