import { NextRequest, NextResponse } from 'next/server';

// This API route fetches token data from GeckoTerminal
// NextRequest is used to get the request body with json()
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { address, chainId = '1' } = body;
    
    if (!address) {
      return NextResponse.json({ error: 'Token address is required' }, { status: 400 });
    }
    
    // Map chainId to network name for GeckoTerminal API
    const network = chainId === 'sol' ? 'solana' : 'eth';
    
    // Fetch token data from external API
    const response = await fetch(`https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${address}`);
    
    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch token data' }, { status: response.status });
    }
    
    const data = await response.json();
    
    // Return only the data we need
    return NextResponse.json({ 
      token_data: data 
    });
  } catch (error: unknown) {
    console.error('Error fetching token data:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 