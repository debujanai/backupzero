import { ethers } from 'ethers';
import { NETWORK_CONFIG, TOKEN_PAIRS } from '../constants/networks';
import { PRICE_FEED_ABI } from '../constants/contracts';
import { TokenPair, PriceRatio } from '../types';

export const getGasPrice = async (provider: ethers.Provider): Promise<bigint> => {
  try {
    const feeData = await provider.getFeeData();
    return feeData.gasPrice || BigInt(20000000000); // 20 gwei default
  } catch (error) {
    console.error('Error fetching gas price:', error);
    return BigInt(20000000000); // 20 gwei fallback
  }
};

export const optimizeGas = async (provider: ethers.Provider, estimatedGas: bigint): Promise<{
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}> => {
  try {
    const feeData = await provider.getFeeData();
    
    // If EIP-1559 is supported
    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
      return {
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
      };
    }
    
    // Fallback to legacy gas pricing
    const gasPrice = feeData.gasPrice || BigInt(20000000000);
    return {
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: gasPrice
    };
  } catch (error) {
    console.error('Error optimizing gas:', error);
    const fallbackGasPrice = BigInt(20000000000);
    return {
      maxFeePerGas: fallbackGasPrice,
      maxPriorityFeePerGas: fallbackGasPrice
    };
  }
};

export const safeStringify = (obj: any): string => {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  }, 2);
};

// Network helper functions
export const getNetworkConfig = (chainId: number) => {
  return NETWORK_CONFIG[chainId as keyof typeof NETWORK_CONFIG];
};

export const getBlockExplorerUrl = (chainId: number, address: string): string => {
  const network = getNetworkConfig(chainId);
  return network ? `${network.blockExplorer}/address/${address}` : '';
};

export const getTransactionUrl = (chainId: number, txHash: string): string => {
  const network = getNetworkConfig(chainId);
  return network ? `${network.blockExplorer}/tx/${txHash}` : '';
};

export const getNetworkName = (chainId: number): string => {
  const network = getNetworkConfig(chainId);
  return network ? network.name : 'Unknown Network';
};

export const getNetworkSymbol = (chainId: number): string => {
  const network = getNetworkConfig(chainId);
  return network ? network.symbol : 'ETH';
};

export const getRouterAddress = (chainId: number): string => {
  const network = getNetworkConfig(chainId);
  return network ? network.routerAddress : '';
};

export const getFactoryAddress = (chainId: number): string => {
  const network = getNetworkConfig(chainId);
  return network ? network.factoryAddress : '';
};

export const getPositionManagerAddress = (chainId: number): string => {
  const network = getNetworkConfig(chainId);
  return network ? network.positionManagerAddress : '';
};

export const getFactoryV3Address = (chainId: number): string => {
  const network = getNetworkConfig(chainId);
  return network ? network.factoryV3Address : '';
};

export const getAvailableDEXs = (chainId: number): Array<'uniswap_v2' | 'uniswap_v3'> => {
  switch (chainId) {
    case 1: // Ethereum
      return ['uniswap_v2', 'uniswap_v3'];
    case 137: // Polygon
      return ['uniswap_v2', 'uniswap_v3'];
    case 56: // BSC
      return ['uniswap_v2']; // PancakeSwap uses V2
    case 8453: // Base
      return ['uniswap_v2', 'uniswap_v3'];
    case 42161: // Arbitrum
      return ['uniswap_v2', 'uniswap_v3'];
    case 10: // Optimism
      return ['uniswap_v2', 'uniswap_v3'];
    case 11155111: // Sepolia
      return ['uniswap_v2', 'uniswap_v3'];
    default:
      return ['uniswap_v2'];
  }
};

export const getTokenPrice = async (
  provider: ethers.Provider,
  priceFeed: string
): Promise<number> => {
  try {
    const aggregator = new ethers.Contract(priceFeed, PRICE_FEED_ABI, provider);
    const [, price] = await aggregator.latestRoundData();
    return parseFloat(ethers.formatUnits(price, 8)); // Chainlink prices are 8 decimals
  } catch (error) {
    console.error('Error fetching token price:', error);
    return 0;
  }
};

export const calculatePriceRatios = async (
  provider: ethers.Provider,
  tokenAmt: string,
  pairAmt: string,
  totalSupply: string,
  chainId: number,
  pairType: 'native' | 'token',
  pairToken?: TokenPair
): Promise<PriceRatio> => {
  try {
    const tokenAmount = parseFloat(tokenAmt);
    const pairAmount = parseFloat(pairAmt);
    
    if (tokenAmount === 0 || pairAmount === 0) {
      return { tokenPerPair: '0', pairPerToken: '0', usdValue: '0' };
    }

    const tokenPerPair = (tokenAmount / pairAmount).toString();
    const pairPerToken = (pairAmount / tokenAmount).toString();
    
    // Calculate USD value
    let usdValue = '0';
    if (pairType === 'native') {
      const network = getNetworkConfig(chainId);
      if (network?.priceFeed) {
        const nativePrice = await getTokenPrice(provider, network.priceFeed);
        usdValue = (pairAmount * nativePrice).toString();
      }
    } else if (pairToken) {
      // For stablecoins, assume 1:1 USD ratio
      if (['USDC', 'USDT', 'DAI', 'BUSD', 'USDbC'].includes(pairToken.symbol)) {
        usdValue = pairAmount.toString();
      }
    }

    return { tokenPerPair, pairPerToken, usdValue };
  } catch (error) {
    console.error('Error calculating price ratios:', error);
    return { tokenPerPair: '0', pairPerToken: '0', usdValue: '0' };
  }
};

// Utility functions
export const formatAddress = (address: string): string => {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

export const formatNumber = (num: string | number): string => {
  const value = typeof num === 'string' ? parseFloat(num) : num;
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(2)}M`;
  } else if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}K`;
  }
  return value.toFixed(2);
};

// Uniswap V3 specific functions
export const getFeeTierName = (feeTier: number): string => {
  switch (feeTier) {
    case 100:
      return '0.01%';
    case 500:
      return '0.05%';
    case 3000:
      return '0.3%';
    case 10000:
      return '1%';
    default:
      return '0.3%';
  }
};

export const calculateSqrtPriceX96 = (price: number): bigint => {
  // Convert price to sqrt price in Q64.96 format
  // sqrtPriceX96 = sqrt(price) * 2^96
  const sqrtPrice = Math.sqrt(price);
  const Q96 = BigInt(2) ** BigInt(96);
  
  // Handle edge cases
  if (sqrtPrice <= 0 || !isFinite(sqrtPrice)) {
    throw new Error('Invalid price for sqrt calculation');
  }
  
  // Convert to bigint safely
  const sqrtPriceX96 = BigInt(Math.floor(sqrtPrice * Math.pow(2, 96)));
  
  // Ensure it's within valid range
  const MIN_SQRT_RATIO = BigInt('4295128739');
  const MAX_SQRT_RATIO = BigInt('1461446703485210103287273052203988822378723970342');
  
  if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 > MAX_SQRT_RATIO) {
    throw new Error('Price out of valid range for Uniswap V3');
  }
  
  return sqrtPriceX96;
};

export const getTickSpacing = (fee: number): number => {
  switch (fee) {
    case 100:
      return 1;
    case 500:
      return 10;
    case 3000:
      return 60;
    case 10000:
      return 200;
    default:
      return 60;
  }
};

export const calculateTicks = (fee: number): { minTick: number, maxTick: number } => {
  const tickSpacing = getTickSpacing(fee);
  const minTick = Math.ceil(-887272 / tickSpacing) * tickSpacing;
  const maxTick = Math.floor(887272 / tickSpacing) * tickSpacing;
  return { minTick, maxTick };
};

export const getUniswapNetworkName = (chainId: number): string => {
  switch (chainId) {
    case 1:
      return 'ethereum';
    case 137:
      return 'polygon';
    case 42161:
      return 'arbitrum';
    case 10:
      return 'optimism';
    case 8453:
      return 'base';
    case 56:
      return 'bnb';
    case 11155111:
      return 'sepolia';
    default:
      return 'ethereum';
  }
};

export const getUniswapPositionLink = (chainId: number): string => {
  const networkName = getUniswapNetworkName(chainId);
  return `https://app.uniswap.org/#/pools?chain=${networkName}`;
}; 