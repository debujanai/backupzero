import { TokenPair } from '../types';

// Network configurations
export const NETWORK_CONFIG = {
  1: {
    name: 'Ethereum',
    symbol: 'ETH',
    rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/demo',
    blockExplorer: 'https://etherscan.io',
    routerAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    factoryAddress: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    positionManagerAddress: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
    factoryV3Address: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    priceFeed: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
  },
  137: {
    name: 'Polygon',
    symbol: 'MATIC',
    rpcUrl: 'https://polygon-rpc.com',
    blockExplorer: 'https://polygonscan.com',
    routerAddress: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff',
    factoryAddress: '0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32',
    positionManagerAddress: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
    factoryV3Address: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    priceFeed: '0xAB594600376Ec9fD91F8e885dADF0CE036862dE0'
  },
  56: {
    name: 'BSC',
    symbol: 'BNB',
    rpcUrl: 'https://bsc-dataseed.binance.org',
    blockExplorer: 'https://bscscan.com',
    routerAddress: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    factoryAddress: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
    positionManagerAddress: '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364',
    factoryV3Address: '0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7',
    priceFeed: '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE'
  },
  8453: {
    name: 'Base',
    symbol: 'ETH',
    rpcUrl: 'https://mainnet.base.org',
    blockExplorer: 'https://basescan.org',
    routerAddress: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
    factoryAddress: '0x8909dc15e40173ff4699343b6eb8132c65e18ec6',
    positionManagerAddress: '0x03a520b32C04BF3bEEf7BF5754aD8E0D80e6b5C9',
    factoryV3Address: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
    priceFeed: '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70'
  },
  42161: {
    name: 'Arbitrum',
    symbol: 'ETH',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    blockExplorer: 'https://arbiscan.io',
    routerAddress: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    factoryAddress: '0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9',
    positionManagerAddress: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
    factoryV3Address: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    priceFeed: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612'
  },
  10: {
    name: 'Optimism',
    symbol: 'ETH',
    rpcUrl: 'https://mainnet.optimism.io',
    blockExplorer: 'https://optimistic.etherscan.io',
    routerAddress: '0x4A7b5Da61326A6379179b40d00F57E5bbDC962c2',
    factoryAddress: '0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf',
    positionManagerAddress: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
    factoryV3Address: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    priceFeed: '0x13e3Ee699D1909E989722E753853AE30b17e08c5'
  }
};

// Token pairs for different networks
export const TOKEN_PAIRS: Record<number, TokenPair[]> = {
  1: [ // Ethereum
    { symbol: 'USDC', name: 'USD Coin', address: '0xA0b86a33E6441b8A4B4A4B4A4A4A4A4A4A4A4A4A', decimals: 6 },
    { symbol: 'USDT', name: 'Tether USD', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    { symbol: 'DAI', name: 'Dai Stablecoin', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
  ],
  137: [ // Polygon
    { symbol: 'USDC', name: 'USD Coin', address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', decimals: 6 },
    { symbol: 'USDT', name: 'Tether USD', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
    { symbol: 'DAI', name: 'Dai Stablecoin', address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', decimals: 18 },
  ],
  56: [ // BSC
    { symbol: 'USDC', name: 'USD Coin', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
    { symbol: 'USDT', name: 'Tether USD', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    { symbol: 'BUSD', name: 'Binance USD', address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', decimals: 18 },
  ],
  8453: [ // Base
    { symbol: 'USDC', name: 'USD Coin', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
    { symbol: 'USDbC', name: 'USD Base Coin', address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', decimals: 6 },
  ],
  42161: [ // Arbitrum
    { symbol: 'USDC', name: 'USD Coin', address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', decimals: 6 },
    { symbol: 'USDT', name: 'Tether USD', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
    { symbol: 'DAI', name: 'Dai Stablecoin', address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', decimals: 18 },
  ],
  10: [ // Optimism
    { symbol: 'USDC', name: 'USD Coin', address: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', decimals: 6 },
    { symbol: 'USDT', name: 'Tether USD', address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6 },
    { symbol: 'DAI', name: 'Dai Stablecoin', address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', decimals: 18 },
  ]
};

export const FEATURES = [
  { id: 'mintable', name: 'Mintable', description: 'Allow owner to mint new tokens after deployment' },
  { id: 'burnable', name: 'Burnable', description: 'Allow token holders to burn their tokens' },
  { id: 'pausable', name: 'Pausable', description: 'Allow owner to pause all token transfers' },
  { id: 'ownable', name: 'Ownable', description: 'Add ownership functionality (recommended)' },
  { id: 'maxWallet', name: 'Max Wallet', description: 'Limit maximum wallet holdings (anti-whale)' },
  { id: 'maxTransaction', name: 'Max Transaction', description: 'Limit maximum transaction amount' },
  { id: 'antiBot', name: 'Anti-Bot Protection', description: 'Protection against bot trading in first blocks' },
  { id: 'tradingDelay', name: 'Trading Delay', description: 'Delay trading start after deployment' },
  { id: 'blacklist', name: 'Blacklist', description: 'Ability to blacklist addresses' },
  { id: 'reflection', name: 'Reflection Rewards', description: 'Reward holders with automatic reflections' }
]; 