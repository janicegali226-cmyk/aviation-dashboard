import mysql from 'mysql2/promise';
import { NextResponse } from 'next/server';

// 1. 将配置项提取出来，保持整洁
const dbConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: {
    rejectUnauthorized: false // TiDB 必须要求开启 SSL
  }
};

export async function GET() {
  let connection;
  try {
    // 2. 在请求进来时创建连接
    connection = await mysql.createConnection(dbConfig);

    // 逻辑：找出过去 1 小时内更新过位置的飞机，并提取它们的最新坐标
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
    
    return NextResponse.json(rows);
  } catch (error) {
    console.error('数据库请求失败:', error);
    return NextResponse.json({ error: 'Failed to fetch flight data' }, { status: 500 });
  } finally {
    // 3. 🚨 核心保命机制：无论成功还是报错，必定执行关闭连接逻辑
    if (connection) {
      await connection.end();
    }
  }
}