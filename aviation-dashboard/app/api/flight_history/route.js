import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  // 1. 提取 searchParams，并同时提取当前的动态域名 origin
  const { searchParams, origin } = new URL(request.url);
  const ident = searchParams.get('ident');

  if (!ident) return NextResponse.json({ error: 'Missing callsign' }, { status: 400 });

  try {
    // 2. 🚨 核心修复：用 origin 替换掉 127.0.0.1:5000
    const response = await fetch(`${origin}/api/history/${ident}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Python 接口报错 (状态码 ${response.status}):`, errorText);
      throw new Error(`Python Backend failed: ${errorText}`);
    }
    
    const pythonData = await response.json(); 
    return NextResponse.json(pythonData);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}