import { NextResponse } from 'next/server';

// Define proper interface for token data
interface TokenInfoData {
  apikey: string;
  module: string;
  action: string;
  address: string;
  tokenname: string;
  tokensymbol: string;
  tokendecimal: string;
  tokeninfo: string;
  totalsupply?: string;
  tokenissuer?: string;
  tokenlogo?: string;
  [key: string]: string | undefined; // Allow for additional properties
}

// Block explorer API endpoints for token info update
const EXPLORER_INFO_ENDPOINTS = {
  // Etherscan
  1: 'https://api.etherscan.io/api', // Mainnet
  5: 'https://api-goerli.etherscan.io/api', // Goerli
  11155111: 'https://api-sepolia.etherscan.io/api', // Sepolia
  17000: 'https://api-holesky.etherscan.io/api', // Holesky
  
  // Polygonscan
  137: 'https://api.polygonscan.com/api', // Polygon Mainnet
  80001: 'https://api-testnet.polygonscan.com/api', // Mumbai Testnet
};

// Get the appropriate API key for the network
function getApiKey(chainId: number): string | undefined {
  if ([1, 5, 11155111, 17000].includes(chainId)) {
    return process.env.ETHERSCAN_API_KEY;
  } else if ([137, 80001].includes(chainId)) {
    return process.env.POLYGONSCAN_API_KEY;
  }
  return undefined;
}

// Get explorer name for logging
function getExplorerName(chainId: number): string {
  if ([1, 5, 11155111, 17000].includes(chainId)) {
    return 'Etherscan';
  } else if ([137, 80001].includes(chainId)) {
    return 'Polygonscan';
  }
  return 'Unknown Explorer';
}

export async function POST(request: Request) {
  try {
    const {
      address,
      tokenName,
      tokenSymbol,
      decimals,
      totalSupply,
      logoUrl,
      description,
      chainId,
      ownerAddress,
      network,
      renounced
    } = await request.json();

    console.log('Received token metadata submission:', {
      address,
      tokenName,
      tokenSymbol,
      network,
      logoUrl: !!logoUrl,
      chainId,
    });

    // Validate required fields
    if (!address || !tokenName || !tokenSymbol || !chainId) {
      console.error('Missing required fields for token metadata');
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get API endpoint for the network
    const apiEndpoint = EXPLORER_INFO_ENDPOINTS[chainId as keyof typeof EXPLORER_INFO_ENDPOINTS];
    if (!apiEndpoint) {
      console.error('Unsupported network for token metadata:', chainId, network);
      return NextResponse.json({ 
        error: 'Unsupported network',
        message: `No API support for network: ${network || chainId}`
      }, { status: 400 });
    }

    // Get appropriate API key
    const apiKey = getApiKey(chainId);
    if (!apiKey) {
      console.error(`${getExplorerName(chainId)} API key not configured for chain ID ${chainId}`);
      return NextResponse.json({ 
        error: 'API key not configured',
        message: `${getExplorerName(chainId)} API key not found in environment variables`
      }, { status: 500 });
    }

    console.log(`Submitting token info to ${getExplorerName(chainId)}:`, apiEndpoint);

    // For block explorers to pick up the token logo, we need to submit tokeninfo
    const tokenInfoData: TokenInfoData = {
      apikey: apiKey,
      module: 'token',
      action: 'tokenupdate',
      address: address,
      tokenname: tokenName,
      tokensymbol: tokenSymbol,
      tokendecimal: String(decimals || '18'),
      tokeninfo: description || `${tokenName} (${tokenSymbol}) token`,
    };

    // Add additional data if available
    if (totalSupply) {
      tokenInfoData.totalsupply = totalSupply;
    }
    
    if (ownerAddress) {
      // Add owner address - important for verification
      tokenInfoData.tokenissuer = ownerAddress;
      
      // If ownership is renounced, add this information
      if (renounced) {
        tokenInfoData.tokeninfo = (tokenInfoData.tokeninfo || '') + ' (Ownership renounced)';
      }
    }

    // If we have a logo URL, add it to the request
    if (logoUrl) {
      // For token logos, explorers require publicly accessible images
      console.log('Adding logo URL to token info:', logoUrl);
      tokenInfoData.tokenlogo = logoUrl;
    }

    // Check for chain-specific parameters
    if ([137, 80001].includes(chainId)) {
      // Polygonscan may need specific parameters
      console.log('Using Polygonscan-specific parameters');
      // If there are any specific Polygonscan parameters, they would go here
    }

    // Submit token info to block explorer
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(Object.entries(tokenInfoData)
        .filter(([, value]) => value !== undefined)
        .reduce((acc, [key, value]) => ({ ...acc, [key]: value as string }), {})
      ).toString(),
    });

    console.log('Token info submission response status:', response.status);

    if (!response.ok) {
      console.error('Failed to submit token info:', response.statusText);
      const errorText = await response.text();
      console.error('Error details:', errorText);
      return NextResponse.json({ 
        error: 'Failed to submit token info',
        message: `${getExplorerName(chainId)} API returned status ${response.status}`,
        details: errorText
      }, { status: 500 });
    }

    const result = await response.json();
    console.log('Token info submission result:', result);

    // Check for Polygonscan specific result handling
    if ([137, 80001].includes(chainId) && result.status === '0') {
      // Some explorers return status 0 with a message
      console.warn('Polygonscan returned status 0:', result.message || result.result);
      
      // If it's just a "Token update in progress" message, consider it a success with warning
      if (result.message && result.message.includes('update in progress')) {
        return NextResponse.json({
          status: 'pending',
          message: `Token info submitted, but ${result.message}`,
          result
        });
      }
      
      return NextResponse.json({
        status: 'warning',
        message: result.message || 'Unexpected response from Polygonscan',
        result
      });
    }

    return NextResponse.json({
      status: 'success',
      message: `Token info submitted successfully to ${getExplorerName(chainId)}`,
      result
    });
  } catch (error) {
    console.error('Token metadata submission error:', error);
    return NextResponse.json(
      { error: 'Failed to submit token metadata', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
} 