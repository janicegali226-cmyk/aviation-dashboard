import mysql from 'mysql2/promise';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // 1. 连接本地 MySQL 数据库
    const connection = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: 'ljn200326', // ⚠️ 注意：这里一定要换成你真实的 MySQL 密码！
      database: 'aviation_dashboard',
    });

    // 2. 执行查询，获取最新抓取的 8 个机场数据
    const [rows] = await connection.execute(
      'SELECT * FROM hub_status_report ORDER BY check_time DESC LIMIT 8'
    );

    await connection.end(); // 拿完数据关闭连接

    // 3. 把数据打包成 JSON 发给前端网页
    return NextResponse.json(rows);
  } catch (error) {
    console.error('数据库连接报错:', error);
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}