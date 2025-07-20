export interface ContractDetails {
  name: string;
  symbol: string;
  decimals: string;
  totalSupply: string;
  features: string[];
  optimizationLevel: 'none' | 'standard' | 'high';
  logoUrl?: string;
  description?: string;
  buyTax: number;
  sellTax: number;
}

export interface AbiItem {
  type: string;
  name?: string;
  inputs?: Array<{ name: string; type: string }>;
  outputs?: Array<{ name: string; type: string }>;
  stateMutability?: string;
}

export interface DeploymentResponse {
  contractCode: string;
  abi: AbiItem[];
  bytecode: string;
  logoUrl?: string;
}

export interface DeploymentResult {
  address: string;
  txHash: string;
  blockNumber: number;
  gasUsed: string;
  verificationStatus: 'pending' | 'success' | 'failed';
  constructorArgs?: string;
}

export interface PriceRatio {
  tokenPerPair: string;
  pairPerToken: string;
  usdValue: string;
}

export interface TokenPair {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
}

export interface LiquidityDetails {
  tokenAmount: string;
  pairAmount: string;
  slippage: number;
  pairType: 'native' | 'token';
  pairToken?: TokenPair;
  dex: 'uniswap_v2' | 'uniswap_v3';
  priceRatio: PriceRatio;
  percentageOfSupply: number;
  feeTier?: 100 | 500 | 3000 | 10000;
}

export interface TransactionStatus {
  approvals: 'pending' | 'complete' | 'skipped' | 'idle';
  poolCreation: 'pending' | 'complete' | 'skipped' | 'idle';
  positionMinting: 'pending' | 'complete' | 'idle';
}

export interface SwapDetails {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  slippage: number;
  recipient: string;
  deadline: number;
}

export interface TransactionDetails {
  hash: string;
  status: 'pending' | 'success' | 'failed';
  blockNumber: number;
  blockConfirmations: number;
  timestamp: string;
  from: string;
  to: string;
  value: string;
  gasPrice: string;
  gasLimit: string;
  gasUsed: string;
  transactionFee: string;
  baseFee?: string;
  maxFee?: string;
  maxPriorityFee?: string;
  burntFee?: string;
  savingsFee?: string;
  txnType?: string;
  nonce?: number;
  positionInBlock?: number;
  inputData?: string;
  methodId?: string;
  decodedInput?: any[];
  logs?: TransactionLog[];
}

export interface TransactionLog {
  address: string;
  name: string;
  topics: string[];
  data: string;
  decodedData?: { [key: string]: any };
}

export type TabType = 'dashboard' | 'deploy' | 'liquidity' | 'manage' | 'liquiditylock' | 'swap'; 