import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { address, chainId = '1' } = await request.json();
    
    if (!address) {
      return NextResponse.json({ error: 'Token address is required' }, { status: 400 });
    }
    
    let url: string;
    
    // Use different endpoint structure for Solana vs Ethereum tokens
    if (chainId === 'sol') {
      url = `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${address}`;
    } else {
      // For Ethereum and other EVM chains
      url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`;
    }
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch data from GoPlus API' }, { status: response.status });
    }
    
    return NextResponse.json({ data });
  } catch (error: unknown) {
    console.error('Error fetching GoPlus data:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 