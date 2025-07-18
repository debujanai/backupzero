import { NextResponse } from 'next/server';
import axios from 'axios';

// Define error interface
interface ApiError extends Error {
  message: string;
}

export async function POST(request: Request) {
  try {
    const { address, chainId = "1" } = await request.json();

    // Validate input
    if (!address) {
      return NextResponse.json({ error: 'Contract address is required' }, { status: 400 });
    }

    try {
      console.log(`Fetching token security data for address: ${address} on chain: ${chainId}`);
      
      // Use axios to directly call the GoPlus API
      const apiUrl = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`;
      console.log(`Calling GoPlus API directly: ${apiUrl}`);
      
      const response = await axios.get(apiUrl);
      const data = response.data;
      
      console.log("GoPlus API response code:", data.code);
      
      if (data.code !== 1) {
        console.error("GoPlus API error:", data.message || "Unknown error");
        return NextResponse.json({ 
          error: data.message || 'Failed to fetch token security data' 
        }, { status: 500 });
      }
      
      // Check if result contains data for the requested address
      if (!data.result || !data.result[address.toLowerCase()]) {
        console.error("No data returned for address:", address);
        return NextResponse.json({ error: 'No security data found for this token' }, { status: 404 });
      }
      
      console.log("Successfully retrieved token security data");
      
      // Return the token security data
      return NextResponse.json({ result: data.result[address.toLowerCase()] });
    } catch (error: unknown) {
      const err = error as ApiError;
      console.error('GoPlus API error:', err);
      return NextResponse.json({ error: err.message || 'Failed to fetch token security data' }, { status: 500 });
    }
  } catch (error: unknown) {
    const err = error as ApiError;
    console.error('Server error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 