'use client';

import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { SwapDetails, TransactionDetails, TokenPair } from '@/types';
import { ERC20_ABI } from '@/constants/contracts';
import { TOKEN_PAIRS } from '@/constants/networks';
import { 
  getNetworkSymbol,
  getRouterAddress,
  formatNumber
} from '@/utils/blockchain';

interface SwapTabProps {
  provider: ethers.BrowserProvider | null;
  signer: ethers.JsonRpcSigner | null;
  account: string;
  chainId: number;
}

const UNISWAP_V2_ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
  "function WETH() external pure returns (address)"
];

// Add Uniswap V3 Router ABI
const UNISWAP_V3_ROUTER_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)",
  "function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96)) external returns (uint256 amountIn)",
  "function WETH9() external pure returns (address)"
];

// Add Uniswap V3 Quoter ABI for price estimation
const UNISWAP_V3_QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)"
];

// Add Uniswap V3 Factory ABI to check pool existence
const UNISWAP_V3_FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"
];

// V3 fee tiers (in basis points)
const V3_FEE_TIERS = [100, 500, 3000, 10000]; // 0.01%, 0.05%, 0.3%, 1%

// Get V3 router address for the network
const getV3RouterAddress = (chainId: number): string => {
  switch (chainId) {
    case 1: return '0xE592427A0AEce92De3Edee1F18E0157C05861564'; // Ethereum
    case 137: return '0xE592427A0AEce92De3Edee1F18E0157C05861564'; // Polygon
    case 56: return '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4'; // BSC
    case 8453: return '0x2626664c2603336E57B271c5C0b26F421741e481'; // Base
    case 42161: return '0xE592427A0AEce92De3Edee1F18E0157C05861564'; // Arbitrum
    case 10: return '0xE592427A0AEce92De3Edee1F18E0157C05861564'; // Optimism
    case 11155111: return '0xE592427A0AEce92De3Edee1F18E0157C05861564'; // Sepolia
    default: return '0xE592427A0AEce92De3Edee1F18E0157C05861564';
  }
};

// Get V3 quoter address for the network
const getV3QuoterAddress = (chainId: number): string => {
  switch (chainId) {
    case 1: return '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6'; // Ethereum
    case 137: return '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6'; // Polygon
    case 56: return '0x78D78E420Da98ad378D7799bE8f4AF69033EB077'; // BSC
    case 8453: return '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a'; // Base
    case 42161: return '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6'; // Arbitrum
    case 10: return '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6'; // Optimism
    case 11155111: return '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6'; // Sepolia
    default: return '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6';
  }
};

// Get V3 factory address for the network
const getV3FactoryAddress = (chainId: number): string => {
  switch (chainId) {
    case 1: return '0x1F98431c8aD98523631AE4a59f267346ea31F984'; // Ethereum
    case 137: return '0x1F98431c8aD98523631AE4a59f267346ea31F984'; // Polygon
    case 56: return '0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7'; // BSC
    case 8453: return '0x33128a8fC17869897dcE68Ed026d694621f6FDfD'; // Base
    case 42161: return '0x1F98431c8aD98523631AE4a59f267346ea31F984'; // Arbitrum
    case 10: return '0x1F98431c8aD98523631AE4a59f267346ea31F984'; // Optimism
    case 11155111: return '0x1F98431c8aD98523631AE4a59f267346ea31F984'; // Sepolia
    default: return '0x1F98431c8aD98523631AE4a59f267346ea31F984';
  }
};

const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

export function SwapTab({ provider, signer, account, chainId }: SwapTabProps) {
  // Swap state
  const [swapDetails, setSwapDetails] = useState<SwapDetails>({
    tokenIn: '',
    tokenOut: '',
    amountIn: '',
    amountOut: '',
    slippage: 0.5,
    recipient: account,
    deadline: Math.floor(Date.now() / 1000) + 1200
  });

  // Custom token input state
  const [customTokenInAddress, setCustomTokenInAddress] = useState('');
  const [customTokenOutAddress, setCustomTokenOutAddress] = useState('');
  const [isCustomTokenIn, setIsCustomTokenIn] = useState(false);
  const [isCustomTokenOut, setIsCustomTokenOut] = useState(false);

  // Transaction state
  const [isSwapping, setIsSwapping] = useState(false);
  const [currentTransaction, setCurrentTransaction] = useState<TransactionDetails | null>(null);
  const [swapError, setSwapError] = useState<string>('');
  const [isApproving, setIsApproving] = useState(false);
  const [approvalTransaction, setApprovalTransaction] = useState<TransactionDetails | null>(null);

  // Token data
  const [tokenInDetails, setTokenInDetails] = useState<any>(null);
  const [tokenOutDetails, setTokenOutDetails] = useState<any>(null);
  const [estimatedOutput, setEstimatedOutput] = useState<string>('');
  const [isPriceLoading, setIsPriceLoading] = useState(false);

  // Available tokens for current network
  const availableTokens = TOKEN_PAIRS[chainId] || [];

  // Get current network symbol
  const networkSymbol = getNetworkSymbol(chainId);

  // Update recipient when account changes
  useEffect(() => {
    setSwapDetails(prev => ({ ...prev, recipient: account }));
  }, [account]);

  // Update native token balances when account or provider changes
  useEffect(() => {
    const updateNativeBalances = async () => {
      if (!provider || !account) return;
      
      const balance = await fetchNativeBalance();
      
      // Update tokenIn balance if it's native
      if (swapDetails.tokenIn === 'native' && tokenInDetails) {
        setTokenInDetails((prev: any) => prev ? { ...prev, balance } : null);
      }
      
      // Update tokenOut balance if it's native
      if (swapDetails.tokenOut === 'native' && tokenOutDetails) {
        setTokenOutDetails((prev: any) => prev ? { ...prev, balance } : null);
      }
    };

    updateNativeBalances();
  }, [account, provider, swapDetails.tokenIn, swapDetails.tokenOut]);

  // Fetch token details
  const fetchTokenDetails = async (tokenAddress: string, isTokenIn: boolean) => {
    if (!provider || !tokenAddress || !ethers.isAddress(tokenAddress)) return;

    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      
      // Try to fetch token details with fallbacks for non-standard tokens
      let name, symbol, decimals, balance;
      
      try {
        // Try standard ERC-20 calls first
        [name, symbol, decimals, balance] = await Promise.all([
          tokenContract.name().catch(() => 'Unknown Token'),
          tokenContract.symbol().catch(() => 'UNKNOWN'),
          tokenContract.decimals().catch(() => 18),
          tokenContract.balanceOf(account).catch(() => BigInt(0))
        ]);
      } catch (error) {
        // If Promise.all fails, try individual calls with more fallbacks
        console.warn('Standard ERC-20 calls failed, trying individual calls:', error);
        
        try {
          name = await tokenContract.name();
        } catch {
          name = 'Unknown Token';
        }
        
        try {
          symbol = await tokenContract.symbol();
        } catch {
          symbol = 'UNKNOWN';
        }
        
        try {
          decimals = await tokenContract.decimals();
        } catch {
          decimals = 18; // Default to 18 decimals
        }
        
        try {
          balance = await tokenContract.balanceOf(account);
        } catch {
          balance = BigInt(0);
        }
      }

      const tokenDetails = {
        address: tokenAddress,
        name: name || 'Unknown Token',
        symbol: symbol || 'UNKNOWN',
        decimals: Number(decimals),
        balance: ethers.formatUnits(balance, decimals)
      };

      if (isTokenIn) {
        setTokenInDetails(tokenDetails);
      } else {
        setTokenOutDetails(tokenDetails);
      }
    } catch (error) {
      console.error('Error fetching token details:', error);
      
      // Create minimal token details for non-standard tokens
      const fallbackTokenDetails = {
        address: tokenAddress,
        name: 'Unknown Token',
        symbol: 'UNKNOWN',
        decimals: 18,
        balance: '0'
      };
      
      if (isTokenIn) {
        setTokenInDetails(fallbackTokenDetails);
      } else {
        setTokenOutDetails(fallbackTokenDetails);
      }
    }
  };

  // Validate if address is a valid ERC-20 token
  const validateTokenContract = async (tokenAddress: string) => {
    if (!provider || !ethers.isAddress(tokenAddress)) return false;
    
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      
      // Check if contract has basic ERC-20 functions
      const code = await provider.getCode(tokenAddress);
      if (code === '0x') return false; // No contract at address
      
      // Try to call totalSupply as a basic check
      await tokenContract.totalSupply();
      return true;
    } catch (error) {
      console.warn('Token validation failed:', error);
      return false;
    }
  };

  // Handle custom token address input
  const handleCustomTokenAddress = async (address: string, isTokenIn: boolean) => {
    if (isTokenIn) {
      setCustomTokenInAddress(address);
      if (ethers.isAddress(address)) {
        const isValid = await validateTokenContract(address);
        if (isValid) {
          setSwapDetails(prev => ({ ...prev, tokenIn: address }));
          await fetchTokenDetails(address, true);
        } else {
          setTokenInDetails({
            address: address,
            name: 'Invalid Token',
            symbol: 'INVALID',
            decimals: 18,
            balance: '0'
          });
        }
      }
    } else {
      setCustomTokenOutAddress(address);
      if (ethers.isAddress(address)) {
        const isValid = await validateTokenContract(address);
        if (isValid) {
          setSwapDetails(prev => ({ ...prev, tokenOut: address }));
          await fetchTokenDetails(address, false);
        } else {
          setTokenOutDetails({
            address: address,
            name: 'Invalid Token',
            symbol: 'INVALID',
            decimals: 18,
            balance: '0'
          });
        }
      }
    }
  };

  // Estimate output amount
  const estimateOutputAmount = async () => {
    if (!provider || !swapDetails.tokenIn || !swapDetails.tokenOut || !swapDetails.amountIn) {
      setEstimatedOutput('');
      return;
    }

    setIsPriceLoading(true);
    
    try {
      const amountIn = ethers.parseUnits(swapDetails.amountIn, tokenInDetails?.decimals || 18);
      
      // Try V3 first (better liquidity and pricing)
      const v3Result = await estimateV3Price(amountIn);
      if (v3Result.success) {
        setEstimatedOutput(v3Result.output);
        setIsPriceLoading(false);
        return;
      }

      // Fallback to V2 if V3 fails
      const v2Result = await estimateV2Price(amountIn);
      if (v2Result.success) {
        setEstimatedOutput(v2Result.output);
      } else {
        setEstimatedOutput('No liquidity available');
      }
    } catch (error) {
      console.error('Error estimating output:', error);
      setEstimatedOutput('Unable to estimate');
    } finally {
      setIsPriceLoading(false);
    }
  };

  // Estimate price using Uniswap V3
  const estimateV3Price = async (amountIn: bigint): Promise<{ success: boolean; output: string; fee?: number }> => {
    try {
      const quoterAddress = getV3QuoterAddress(chainId);
      const factoryAddress = getV3FactoryAddress(chainId);
      const quoter = new ethers.Contract(quoterAddress, UNISWAP_V3_QUOTER_ABI, provider);
      const factory = new ethers.Contract(factoryAddress, UNISWAP_V3_FACTORY_ABI, provider);
      
      // Get WETH address for native token swaps
      const v3Router = new ethers.Contract(getV3RouterAddress(chainId), UNISWAP_V3_ROUTER_ABI, provider);
      const wethAddress = await v3Router.WETH9();
      
      let tokenIn = swapDetails.tokenIn;
      let tokenOut = swapDetails.tokenOut;
      
      // Handle native token swaps
      if (tokenIn === 'native') tokenIn = wethAddress;
      if (tokenOut === 'native') tokenOut = wethAddress;
      
      // Same token check
      if (tokenIn === tokenOut) {
        return { success: true, output: swapDetails.amountIn };
      }

      // Try different fee tiers to find the best pool
      let bestOutput = BigInt(0);
      let bestFee = 0;
      
      for (const fee of V3_FEE_TIERS) {
        try {
          // Check if pool exists
          const poolAddress = await factory.getPool(tokenIn, tokenOut, fee);
          if (poolAddress === ethers.ZeroAddress) continue;
          
          // Get quote for this fee tier
          const quote = await quoter.quoteExactInputSingle.staticCall(
            tokenIn,
            tokenOut,
            fee,
            amountIn,
            0 // sqrtPriceLimitX96 = 0 (no limit)
          );
          
          if (quote > bestOutput) {
            bestOutput = quote;
            bestFee = fee;
          }
        } catch (error) {
          // This fee tier doesn't have a pool or has no liquidity
          continue;
        }
      }
      
      if (bestOutput > 0) {
        const output = ethers.formatUnits(bestOutput, tokenOutDetails?.decimals || 18);
        return { success: true, output, fee: bestFee };
      }
      
      return { success: false, output: '' };
    } catch (error) {
      console.error('V3 price estimation failed:', error);
      return { success: false, output: '' };
    }
  };

  // Estimate price using Uniswap V2
  const estimateV2Price = async (amountIn: bigint): Promise<{ success: boolean; output: string }> => {
    try {
      const routerAddress = getRouterAddress(chainId);
      const router = new ethers.Contract(routerAddress, UNISWAP_V2_ROUTER_ABI, provider);
      const wethAddress = await router.WETH();
      
      let path: string[];
      
      // Build the optimal path
      if (swapDetails.tokenIn === 'native') {
        path = [wethAddress, swapDetails.tokenOut];
      } else if (swapDetails.tokenOut === 'native') {
        path = [swapDetails.tokenIn, wethAddress];
      } else if (swapDetails.tokenIn === swapDetails.tokenOut) {
        // Same token, 1:1 ratio
        return { success: true, output: swapDetails.amountIn };
      } else {
        // Try direct path first, then via WETH
        path = [swapDetails.tokenIn, swapDetails.tokenOut];
      }

      try {
        // Try to get amounts with current path
        const amounts = await router.getAmountsOut(amountIn, path);
        const outputAmount = amounts[amounts.length - 1];
        const output = ethers.formatUnits(outputAmount, tokenOutDetails?.decimals || 18);
        return { success: true, output };
      } catch (directPathError) {
        // Direct path failed, try via WETH if not already using it
        if (path.length === 2 && swapDetails.tokenIn !== 'native' && swapDetails.tokenOut !== 'native') {
          try {
            path = [swapDetails.tokenIn, wethAddress, swapDetails.tokenOut];
            const amounts = await router.getAmountsOut(amountIn, path);
            const outputAmount = amounts[amounts.length - 1];
            const output = ethers.formatUnits(outputAmount, tokenOutDetails?.decimals || 18);
            return { success: true, output };
          } catch (wethPathError) {
            console.warn('No liquidity path found via WETH:', wethPathError);
            return { success: false, output: '' };
          }
        } else {
          console.warn('No direct liquidity path found:', directPathError);
          return { success: false, output: '' };
        }
      }
    } catch (error) {
      console.error('V2 price estimation failed:', error);
      return { success: false, output: '' };
    }
  };

  // Approve token spending
  const approveToken = async () => {
    if (!signer || !swapDetails.tokenIn || swapDetails.tokenIn === 'native') return;

    setIsApproving(true);
    setSwapError('');

    try {
      const tokenContract = new ethers.Contract(swapDetails.tokenIn, ERC20_ABI, signer);
      const v2RouterAddress = getRouterAddress(chainId);
      const v3RouterAddress = getV3RouterAddress(chainId);
      const amountIn = ethers.parseUnits(swapDetails.amountIn, tokenInDetails?.decimals || 18);
      
      // Check current allowances for both routers
      const [v2Allowance, v3Allowance] = await Promise.all([
        tokenContract.allowance(account, v2RouterAddress),
        tokenContract.allowance(account, v3RouterAddress)
      ]);
      
      const approvalTransactions: TransactionDetails[] = [];
      
      // Approve V2 router if needed
      if (v2Allowance < amountIn) {
        const v2ApproveTx = await tokenContract.approve(v2RouterAddress, ethers.MaxUint256);
        
        const v2ApprovalDetails: TransactionDetails = {
          hash: v2ApproveTx.hash,
          status: 'pending',
          blockNumber: 0,
          blockConfirmations: 0,
          timestamp: new Date().toISOString(),
          from: account,
          to: v2RouterAddress,
          value: '0',
          gasPrice: v2ApproveTx.gasPrice?.toString() || '0',
          gasLimit: v2ApproveTx.gasLimit?.toString() || '0',
          gasUsed: '0',
          transactionFee: '0',
          txnType: '2',
          nonce: v2ApproveTx.nonce,
          inputData: v2ApproveTx.data || '',
          methodId: '0x095ea7b3',
          logs: []
        };
        
        approvalTransactions.push(v2ApprovalDetails);
        
        const v2Receipt = await v2ApproveTx.wait();
        if (v2Receipt) {
          const updatedV2ApprovalDetails: TransactionDetails = {
            ...v2ApprovalDetails,
            status: 'success',
            blockNumber: v2Receipt.blockNumber,
            blockConfirmations: 4,
            gasUsed: v2Receipt.gasUsed.toString(),
            transactionFee: ethers.formatEther(v2Receipt.gasUsed * (v2ApproveTx.gasPrice || BigInt(0))),
            logs: v2Receipt.logs.map((log: any, index: number) => ({
              address: log.address,
              name: log.address === swapDetails.tokenIn ? 'Approval' : 'LogFeeTransfer',
              topics: log.topics,
              data: log.data,
              decodedData: log.address === swapDetails.tokenIn ? {
                owner: account,
                spender: v2RouterAddress,
                amount: ethers.MaxUint256.toString()
              } : {}
            }))
          };
          
          approvalTransactions[approvalTransactions.length - 1] = updatedV2ApprovalDetails;
        }
      }
      
      // Approve V3 router if needed
      if (v3Allowance < amountIn) {
        const v3ApproveTx = await tokenContract.approve(v3RouterAddress, ethers.MaxUint256);
        
        const v3ApprovalDetails: TransactionDetails = {
          hash: v3ApproveTx.hash,
          status: 'pending',
          blockNumber: 0,
          blockConfirmations: 0,
          timestamp: new Date().toISOString(),
          from: account,
          to: v3RouterAddress,
          value: '0',
          gasPrice: v3ApproveTx.gasPrice?.toString() || '0',
          gasLimit: v3ApproveTx.gasLimit?.toString() || '0',
          gasUsed: '0',
          transactionFee: '0',
          txnType: '2',
          nonce: v3ApproveTx.nonce,
          inputData: v3ApproveTx.data || '',
          methodId: '0x095ea7b3',
          logs: []
        };
        
        approvalTransactions.push(v3ApprovalDetails);
        
        const v3Receipt = await v3ApproveTx.wait();
        if (v3Receipt) {
          const updatedV3ApprovalDetails: TransactionDetails = {
            ...v3ApprovalDetails,
            status: 'success',
            blockNumber: v3Receipt.blockNumber,
            blockConfirmations: 4,
            gasUsed: v3Receipt.gasUsed.toString(),
            transactionFee: ethers.formatEther(v3Receipt.gasUsed * (v3ApproveTx.gasPrice || BigInt(0))),
            logs: v3Receipt.logs.map((log: any, index: number) => ({
              address: log.address,
              name: log.address === swapDetails.tokenIn ? 'Approval' : 'LogFeeTransfer',
              topics: log.topics,
              data: log.data,
              decodedData: log.address === swapDetails.tokenIn ? {
                owner: account,
                spender: v3RouterAddress,
                amount: ethers.MaxUint256.toString()
              } : {}
            }))
          };
          
          approvalTransactions[approvalTransactions.length - 1] = updatedV3ApprovalDetails;
        }
      }
      
      // Set the last approval transaction for display
      if (approvalTransactions.length > 0) {
        setApprovalTransaction(approvalTransactions[approvalTransactions.length - 1]);
      }
      
    } catch (error) {
      console.error('Approval error:', error);
      setSwapError('Approval failed: ' + (error as Error).message);
    } finally {
      setIsApproving(false);
    }
  };

  // Execute swap
  const executeSwap = async () => {
    if (!signer || !swapDetails.tokenIn || !swapDetails.tokenOut || !swapDetails.amountIn) return;

    // Check if we have a valid price estimate
    if (estimatedOutput === 'No liquidity available' || estimatedOutput === 'Unable to estimate' || !estimatedOutput) {
      setSwapError('Cannot execute swap: No liquidity available for this token pair');
      return;
    }

    setIsSwapping(true);
    setSwapError('');

    try {
      const amountIn = ethers.parseUnits(swapDetails.amountIn, tokenInDetails?.decimals || 18);
      const amountOutMin = ethers.parseUnits(
        (parseFloat(estimatedOutput) * (1 - swapDetails.slippage / 100)).toString(),
        tokenOutDetails?.decimals || 18
      );

      // Try V3 first (better liquidity and pricing)
      const v3Result = await executeV3Swap(amountIn, amountOutMin);
      if (v3Result.success && v3Result.transaction) {
        setCurrentTransaction(v3Result.transaction);
        return;
      }

      // Fallback to V2 if V3 fails
      const v2Result = await executeV2Swap(amountIn, amountOutMin);
      if (v2Result.success && v2Result.transaction) {
        setCurrentTransaction(v2Result.transaction);
      } else {
        setSwapError('Swap failed: No liquidity available on any DEX');
      }
    } catch (error) {
      console.error('Swap error:', error);
      setSwapError('Swap failed: ' + (error as Error).message);
    } finally {
      setIsSwapping(false);
    }
  };

  // Execute V3 swap
  const executeV3Swap = async (amountIn: bigint, amountOutMin: bigint): Promise<{ success: boolean; transaction?: TransactionDetails }> => {
    try {
      const v3RouterAddress = getV3RouterAddress(chainId);
      const factoryAddress = getV3FactoryAddress(chainId);
      const v3Router = new ethers.Contract(v3RouterAddress, UNISWAP_V3_ROUTER_ABI, signer);
      const factory = new ethers.Contract(factoryAddress, UNISWAP_V3_FACTORY_ABI, provider);
      
      // Get WETH address
      const wethAddress = await v3Router.WETH9();
      
      let tokenIn = swapDetails.tokenIn;
      let tokenOut = swapDetails.tokenOut;
      
      // Handle native token swaps
      if (tokenIn === 'native') tokenIn = wethAddress;
      if (tokenOut === 'native') tokenOut = wethAddress;
      
      // Find the best fee tier with liquidity
      let bestFee = 0;
      let bestOutput = BigInt(0);
      
      for (const fee of V3_FEE_TIERS) {
        try {
          const poolAddress = await factory.getPool(tokenIn, tokenOut, fee);
          if (poolAddress === ethers.ZeroAddress) continue;
          
          // Try to get a quote to verify liquidity
          const quoterAddress = getV3QuoterAddress(chainId);
          const quoter = new ethers.Contract(quoterAddress, UNISWAP_V3_QUOTER_ABI, provider);
          const quote = await quoter.quoteExactInputSingle.staticCall(
            tokenIn,
            tokenOut,
            fee,
            amountIn,
            0
          );
          
          if (quote > bestOutput) {
            bestOutput = quote;
            bestFee = fee;
          }
        } catch (error) {
          continue;
        }
      }
      
      if (bestFee === 0) {
        return { success: false };
      }

      let swapTx: ethers.ContractTransactionResponse;
      
      // Execute the swap based on token types
      if (swapDetails.tokenIn === 'native') {
        // Native to token swap
        swapTx = await v3Router.exactInputSingle({
          tokenIn: wethAddress,
          tokenOut: swapDetails.tokenOut,
          fee: bestFee,
          recipient: swapDetails.recipient,
          deadline: swapDetails.deadline,
          amountIn: amountIn,
          amountOutMinimum: amountOutMin,
          sqrtPriceLimitX96: 0
        }, { value: amountIn });
      } else if (swapDetails.tokenOut === 'native') {
        // Token to native swap
        swapTx = await v3Router.exactInputSingle({
          tokenIn: swapDetails.tokenIn,
          tokenOut: wethAddress,
          fee: bestFee,
          recipient: swapDetails.recipient,
          deadline: swapDetails.deadline,
          amountIn: amountIn,
          amountOutMinimum: amountOutMin,
          sqrtPriceLimitX96: 0
        });
      } else {
        // Token to token swap
        swapTx = await v3Router.exactInputSingle({
          tokenIn: swapDetails.tokenIn,
          tokenOut: swapDetails.tokenOut,
          fee: bestFee,
          recipient: swapDetails.recipient,
          deadline: swapDetails.deadline,
          amountIn: amountIn,
          amountOutMinimum: amountOutMin,
          sqrtPriceLimitX96: 0
        });
      }

      // Create transaction details
      const transactionDetails: TransactionDetails = {
        hash: swapTx.hash,
        status: 'pending',
        blockNumber: 0,
        blockConfirmations: 0,
        timestamp: new Date().toISOString(),
        from: account,
        to: v3RouterAddress,
        value: swapDetails.tokenIn === 'native' ? ethers.formatEther(amountIn) : '0',
        gasPrice: swapTx.gasPrice?.toString() || '0',
        gasLimit: swapTx.gasLimit?.toString() || '0',
        gasUsed: '0',
        transactionFee: '0',
        txnType: '2',
        nonce: swapTx.nonce,
        inputData: swapTx.data || '',
        logs: []
      };

      // Wait for transaction receipt
      const receipt = await swapTx.wait();

      // Update transaction with receipt data
      if (receipt) {
        const updatedTransactionDetails: TransactionDetails = {
          ...transactionDetails,
          status: 'success',
          blockNumber: receipt.blockNumber,
          blockConfirmations: 4,
          gasUsed: receipt.gasUsed.toString(),
          transactionFee: ethers.formatEther(receipt.gasUsed * (swapTx.gasPrice || BigInt(0))),
          logs: receipt.logs.map((log: any, index: number) => ({
            address: log.address,
            name: index === 0 ? 'Transfer' : 'Swap',
            topics: log.topics,
            data: log.data,
            decodedData: {}
          }))
        };

        return { success: true, transaction: updatedTransactionDetails };
      }

      return { success: false };
    } catch (error) {
      console.error('V3 swap failed:', error);
      return { success: false };
    }
  };

  // Execute V2 swap
  const executeV2Swap = async (amountIn: bigint, amountOutMin: bigint): Promise<{ success: boolean; transaction?: TransactionDetails }> => {
    try {
      const routerAddress = getRouterAddress(chainId);
      const router = new ethers.Contract(routerAddress, UNISWAP_V2_ROUTER_ABI, signer);
      const wethAddress = await router.WETH();
      
      let path: string[];
      let swapTx: ethers.ContractTransactionResponse;
      
      // Build the same path logic as estimation
      if (swapDetails.tokenIn === 'native') {
        // ETH/MATIC to Token
        path = [wethAddress, swapDetails.tokenOut];
        swapTx = await router.swapExactETHForTokens(
          amountOutMin,
          path,
          swapDetails.recipient,
          swapDetails.deadline,
          { value: amountIn }
        );
      } else if (swapDetails.tokenOut === 'native') {
        // Token to ETH/MATIC
        path = [swapDetails.tokenIn, wethAddress];
        swapTx = await router.swapExactTokensForETH(
          amountIn,
          amountOutMin,
          path,
          swapDetails.recipient,
          swapDetails.deadline
        );
      } else {
        // Token to Token - try direct path first
        path = [swapDetails.tokenIn, swapDetails.tokenOut];
        
        try {
          // Test the path first
          await router.getAmountsOut(amountIn, path);
          swapTx = await router.swapExactTokensForTokens(
            amountIn,
            amountOutMin,
            path,
            swapDetails.recipient,
            swapDetails.deadline
          );
        } catch (directPathError) {
          // Use WETH path if direct path fails
          path = [swapDetails.tokenIn, wethAddress, swapDetails.tokenOut];
          swapTx = await router.swapExactTokensForTokens(
            amountIn,
            amountOutMin,
            path,
            swapDetails.recipient,
            swapDetails.deadline
          );
        }
      }

      // Create transaction details
      const transactionDetails: TransactionDetails = {
        hash: swapTx.hash,
        status: 'pending',
        blockNumber: 0,
        blockConfirmations: 0,
        timestamp: new Date().toISOString(),
        from: account,
        to: routerAddress,
        value: swapDetails.tokenIn === 'native' ? ethers.formatEther(amountIn) : '0',
        gasPrice: swapTx.gasPrice?.toString() || '0',
        gasLimit: swapTx.gasLimit?.toString() || '0',
        gasUsed: '0',
        transactionFee: '0',
        txnType: '2',
        nonce: swapTx.nonce,
        inputData: swapTx.data || '',
        logs: []
      };

      // Wait for transaction receipt
      const receipt = await swapTx.wait();

      // Update transaction with receipt data
      if (receipt) {
        const updatedTransactionDetails: TransactionDetails = {
          ...transactionDetails,
          status: 'success',
          blockNumber: receipt.blockNumber,
          blockConfirmations: 4,
          gasUsed: receipt.gasUsed.toString(),
          transactionFee: ethers.formatEther(receipt.gasUsed * (swapTx.gasPrice || BigInt(0))),
          logs: receipt.logs.map((log: any, index: number) => ({
            address: log.address,
            name: index === 0 ? 'Transfer' : 'Swap',
            topics: log.topics,
            data: log.data,
            decodedData: {}
          }))
        };

        return { success: true, transaction: updatedTransactionDetails };
      }

      return { success: false };
    } catch (error) {
      console.error('V2 swap failed:', error);
      return { success: false };
    }
  };

  // Fetch native token balance
  const fetchNativeBalance = async () => {
    if (!provider || !account) return '0';
    
    try {
      const balance = await provider.getBalance(account);
      return ethers.formatEther(balance);
    } catch (error) {
      console.error('Error fetching native balance:', error);
      return '0';
    }
  };

  // Handle token selection
  const handleTokenSelect = (tokenAddress: string, isTokenIn: boolean) => {
    if (tokenAddress === 'custom') {
      if (isTokenIn) {
        setIsCustomTokenIn(true);
        setSwapDetails(prev => ({ ...prev, tokenIn: '' }));
        setTokenInDetails(null);
      } else {
        setIsCustomTokenOut(true);
        setSwapDetails(prev => ({ ...prev, tokenOut: '' }));
        setTokenOutDetails(null);
      }
    } else {
      if (isTokenIn) {
        setIsCustomTokenIn(false);
        setCustomTokenInAddress('');
        setSwapDetails(prev => ({ ...prev, tokenIn: tokenAddress }));
        if (tokenAddress !== 'native') {
          fetchTokenDetails(tokenAddress, true);
        } else {
          // Fetch native token balance
          fetchNativeBalance().then(balance => {
            setTokenInDetails({
              address: 'native',
              name: networkSymbol,
              symbol: networkSymbol,
              decimals: 18,
              balance: balance
            });
          });
        }
      } else {
        setIsCustomTokenOut(false);
        setCustomTokenOutAddress('');
        setSwapDetails(prev => ({ ...prev, tokenOut: tokenAddress }));
        if (tokenAddress !== 'native') {
          fetchTokenDetails(tokenAddress, false);
        } else {
          // Fetch native token balance
          fetchNativeBalance().then(balance => {
            setTokenOutDetails({
              address: 'native',
              name: networkSymbol,
              symbol: networkSymbol,
              decimals: 18,
              balance: balance
            });
          });
        }
      }
    }
  };

  // Update estimated output when inputs change
  useEffect(() => {
    if (swapDetails.tokenIn && swapDetails.tokenOut && swapDetails.amountIn) {
      estimateOutputAmount();
    }
  }, [swapDetails.tokenIn, swapDetails.tokenOut, swapDetails.amountIn]);

  const renderTransactionDetails = (transaction: TransactionDetails) => {
    const getBlockExplorerUrl = (hash: string) => {
      switch (chainId) {
        case 1: return `https://etherscan.io/tx/${hash}`;
        case 137: return `https://polygonscan.com/tx/${hash}`;
        case 56: return `https://bscscan.com/tx/${hash}`;
        case 8453: return `https://basescan.org/tx/${hash}`;
        case 42161: return `https://arbiscan.io/tx/${hash}`;
        case 10: return `https://optimistic.etherscan.io/tx/${hash}`;
        case 11155111: return `https://sepolia.etherscan.io/tx/${hash}`;
        default: return `https://etherscan.io/tx/${hash}`;
      }
    };

    const formatAddress = (address: string) => {
      return `${address.slice(0, 10)}...${address.slice(-10)}`;
    };

    const formatTimestamp = (timestamp: string) => {
      const date = new Date(timestamp);
      const now = new Date();
      const diffSecs = Math.floor((now.getTime() - date.getTime()) / 1000);
      
      if (diffSecs < 60) return `${diffSecs} secs ago`;
      if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)} mins ago`;
      return date.toUTCString();
    };

    return (
      <div className="transaction-details">
        <div className="transaction-header">
          <h3>Transaction Action</h3>
          <div className="action-badge">
            {transaction.hash === approvalTransaction?.hash ? 'Approve' : 'Swap'}
          </div>
        </div>

        <div className="transaction-info">
          <div className="info-row">
            <span className="info-label">Transaction Hash:</span>
            <a 
              href={getBlockExplorerUrl(transaction.hash)} 
              target="_blank" 
              rel="noopener noreferrer"
              className="hash-link"
            >
              {transaction.hash}
            </a>
          </div>

          <div className="info-row">
            <span className="info-label">Status:</span>
            <span className={`status ${transaction.status}`}>{transaction.status}</span>
          </div>

          <div className="info-row">
            <span className="info-label">Block:</span>
            <span>{transaction.blockNumber}</span>
          </div>

          <div className="info-row">
            <span className="info-label">Block Confirmations:</span>
            <span>{transaction.blockConfirmations}</span>
          </div>

          <div className="info-row">
            <span className="info-label">Timestamp:</span>
            <span>{formatTimestamp(transaction.timestamp)}</span>
          </div>

          <div className="info-row">
            <span className="info-label">From:</span>
            <span className="address">{formatAddress(transaction.from)}</span>
          </div>

          <div className="info-row">
            <span className="info-label">To:</span>
            <span className="address">{formatAddress(transaction.to)}</span>
          </div>

          <div className="info-row">
            <span className="info-label">Value:</span>
            <span>
              {transaction.value} {networkSymbol}
              <span className="usd-value">($0.00)</span>
            </span>
          </div>

          <div className="info-row">
            <span className="info-label">Transaction Fee:</span>
            <span>
              {transaction.transactionFee} {networkSymbol}
              <span className="usd-value">($0.00)</span>
            </span>
          </div>

          <div className="info-row">
            <span className="info-label">Gas Price:</span>
            <span>{formatNumber(transaction.gasPrice)} Gwei</span>
          </div>

          <div className="info-row">
            <span className="info-label">Gas Limit & Usage:</span>
            <span>
              {formatNumber(transaction.gasLimit)} | {formatNumber(transaction.gasUsed)} 
              ({transaction.gasUsed && transaction.gasLimit ? 
                ((parseInt(transaction.gasUsed) / parseInt(transaction.gasLimit)) * 100).toFixed(2) : 0}%)
            </span>
          </div>

          <div className="info-row">
            <span className="info-label">Txn Type:</span>
            <span>{transaction.txnType} (EIP-1559)</span>
          </div>

          <div className="info-row">
            <span className="info-label">Nonce:</span>
            <span>{transaction.nonce}</span>
          </div>

          <div className="info-row">
            <span className="info-label">Position In Block:</span>
            <span>{transaction.positionInBlock || 'Unknown'}</span>
          </div>

          <div className="info-row">
            <span className="info-label">Input Data:</span>
            <div className="input-data">
              <div>Function: {transaction.hash === approvalTransaction?.hash ? 'approve(address spender, uint256 rawAmount)' : 'swap(...)'}</div>
              <div>MethodID: {transaction.methodId}</div>
              {transaction.decodedInput && (
                <div className="decoded-input">
                  {transaction.decodedInput.map((param, index) => (
                    <div key={index}>[{index}]: {param}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {transaction.logs && transaction.logs.length > 0 && (
          <div className="transaction-logs">
            <h4>Transaction Receipt Event Logs</h4>
            {transaction.logs.map((log, index) => (
              <div key={index} className="log-entry">
                <div className="log-header">
                  <span className="log-index">{index + 1}</span>
                  <span className="log-address">{formatAddress(log.address)}</span>
                  <span className="log-name">{log.name}</span>
                </div>
                <div className="log-topics">
                  <div className="topics-label">Topics:</div>
                  {log.topics.map((topic, topicIndex) => (
                    <div key={topicIndex} className="topic">
                      {topicIndex}: {topic}
                    </div>
                  ))}
                </div>
                {log.decodedData && Object.keys(log.decodedData).length > 0 && (
                  <div className="log-data">
                    <div className="data-label">Data:</div>
                    {Object.entries(log.decodedData).map(([key, value]) => (
                      <div key={key} className="data-item">
                        {key}: {value?.toString()}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Swap Interface */}
      <div className="bg-black/20 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
        <h3 className="text-xl font-bold text-white mb-6 font-space-grotesk">Token Swap</h3>
        
        {/* Token In */}
        <div className="space-y-4 mb-6">
          <label className="block text-white/80 text-sm font-medium font-open-sans">From</label>
          <div className="flex gap-4">
            <div className="flex-1">
              <input
                type="number"
                className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-all duration-200"
                value={swapDetails.amountIn}
                onChange={(e) => setSwapDetails(prev => ({ ...prev, amountIn: e.target.value }))}
                placeholder="0.0"
              />
            </div>
            <div className="w-48">
              <select
                className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white focus:outline-none focus:border-purple-500 transition-all duration-200"
                value={isCustomTokenIn ? 'custom' : swapDetails.tokenIn}
                onChange={(e) => handleTokenSelect(e.target.value, true)}
              >
                <option value="">Select token</option>
                <option value="native">{networkSymbol}</option>
                {availableTokens.map(token => (
                  <option key={token.address} value={token.address}>
                    {token.symbol}
                  </option>
                ))}
                <option value="custom">Custom Token</option>
              </select>
            </div>
            {tokenInDetails && parseFloat(tokenInDetails.balance) > 0 && (
              <button
                type="button"
                className="px-4 py-3 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 font-semibold rounded-lg transition-all duration-200 border border-purple-500/30"
                onClick={() => {
                  const maxAmount = swapDetails.tokenIn === 'native' 
                    ? Math.max(0, parseFloat(tokenInDetails.balance) - 0.001).toString()
                    : tokenInDetails.balance;
                  setSwapDetails(prev => ({ ...prev, amountIn: maxAmount }));
                }}
              >
                MAX
              </button>
            )}
          </div>
          
          {isCustomTokenIn && (
            <div className="mt-4">
              <input
                type="text"
                className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-all duration-200"
                value={customTokenInAddress}
                onChange={(e) => handleCustomTokenAddress(e.target.value, true)}
                placeholder="Enter token contract address (0x...)"
              />
            </div>
          )}
          
          {tokenInDetails && (
            <div className="bg-black/30 rounded-xl p-4 border border-white/10">
              <div className="text-white/80 text-sm font-open-sans">
                Balance: {formatNumber(tokenInDetails.balance)} {tokenInDetails.symbol}
              </div>
              {tokenInDetails.name && tokenInDetails.name !== tokenInDetails.symbol && (
                <div className="text-white/60 text-sm mt-1">{tokenInDetails.name}</div>
              )}
              {tokenInDetails.symbol === 'INVALID' && (
                <div className="text-red-400 text-sm mt-2">
                  ❌ Invalid token contract - this address is not a valid ERC-20 token
                </div>
              )}
              {tokenInDetails.symbol === 'UNKNOWN' && (
                <div className="text-yellow-400 text-sm mt-2">
                  ⚠️ Non-standard token - may not work properly with swaps
                </div>
              )}
            </div>
          )}
        </div>

        {/* Swap Direction */}
        <div className="flex justify-center my-4">
          <button 
            className="w-12 h-12 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-bold rounded-full transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-purple-500/25"
            onClick={() => {
              const tempTokenIn = swapDetails.tokenIn;
              const tempTokenOut = swapDetails.tokenOut;
              const tempCustomIn = customTokenInAddress;
              const tempCustomOut = customTokenOutAddress;
              const tempIsCustomIn = isCustomTokenIn;
              const tempIsCustomOut = isCustomTokenOut;
              
              setSwapDetails(prev => ({
                ...prev,
                tokenIn: tempTokenOut,
                tokenOut: tempTokenIn,
                amountIn: '',
                amountOut: ''
              }));
              
              setCustomTokenInAddress(tempCustomOut);
              setCustomTokenOutAddress(tempCustomIn);
              setIsCustomTokenIn(tempIsCustomOut);
              setIsCustomTokenOut(tempIsCustomIn);
              
              const tempTokenInDetails = tokenInDetails;
              setTokenInDetails(tokenOutDetails);
              setTokenOutDetails(tempTokenInDetails);
              
              setEstimatedOutput('');
            }}
          >
            ↓
          </button>
        </div>

        {/* Token Out */}
        <div className="space-y-4 mb-6">
          <label className="block text-white/80 text-sm font-medium font-open-sans">To</label>
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <input
                type="text"
                className={`w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-all duration-200 ${
                  estimatedOutput === 'No liquidity available' ? 'border-red-500' : 
                  estimatedOutput === 'Unable to estimate' ? 'border-yellow-500' : ''
                }`}
                value={isPriceLoading ? 'Fetching price...' : estimatedOutput}
                readOnly
                placeholder="0.0"
              />
              {isPriceLoading && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <svg className="w-5 h-5 text-purple-400 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
                  </svg>
                </div>
              )}
            </div>
            <div className="w-48">
              <select
                className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white focus:outline-none focus:border-purple-500 transition-all duration-200"
                value={isCustomTokenOut ? 'custom' : swapDetails.tokenOut}
                onChange={(e) => handleTokenSelect(e.target.value, false)}
              >
                <option value="">Select token</option>
                <option value="native">{networkSymbol}</option>
                {availableTokens.map(token => (
                  <option key={token.address} value={token.address}>
                    {token.symbol}
                  </option>
                ))}
                <option value="custom">Custom Token</option>
              </select>
            </div>
          </div>
          
          {isCustomTokenOut && (
            <div className="mt-4">
              <input
                type="text"
                className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-all duration-200"
                value={customTokenOutAddress}
                onChange={(e) => handleCustomTokenAddress(e.target.value, false)}
                placeholder="Enter token contract address (0x...)"
              />
            </div>
          )}
          
          {tokenOutDetails && (
            <div className="bg-black/30 rounded-xl p-4 border border-white/10">
              <div className="text-white/80 text-sm font-open-sans">
                Balance: {formatNumber(tokenOutDetails.balance)} {tokenOutDetails.symbol}
              </div>
              {tokenOutDetails.name && tokenOutDetails.name !== tokenOutDetails.symbol && (
                <div className="text-white/60 text-sm mt-1">{tokenOutDetails.name}</div>
              )}
              {tokenOutDetails.symbol === 'INVALID' && (
                <div className="text-red-400 text-sm mt-2">
                  ❌ Invalid token contract - this address is not a valid ERC-20 token
                </div>
              )}
              {tokenOutDetails.symbol === 'UNKNOWN' && (
                <div className="text-yellow-400 text-sm mt-2">
                  ⚠️ Non-standard token - may not work properly with swaps
                </div>
              )}
            </div>
          )}
          
          {estimatedOutput === 'No liquidity available' && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
              <div className="text-yellow-400 text-sm text-center">
                ⚠️ No liquidity pool found for this token pair
              </div>
            </div>
          )}
          
          {estimatedOutput === 'Unable to estimate' && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <div className="text-red-400 text-sm text-center">
                ❌ Unable to fetch price - check network connection
              </div>
            </div>
          )}
        </div>

        {/* Slippage */}
        <div className="space-y-4 mb-6">
          <label className="block text-white/80 text-sm font-medium font-open-sans">Slippage Tolerance (%)</label>
          <input
            type="number"
            className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-all duration-200"
            value={swapDetails.slippage}
            onChange={(e) => setSwapDetails(prev => ({ ...prev, slippage: parseFloat(e.target.value) }))}
            min="0.1"
            max="50"
            step="0.1"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4">
          {swapDetails.tokenIn && swapDetails.tokenIn !== 'native' && (
            <button 
              className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl transition-all duration-200 border border-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={approveToken}
              disabled={isApproving || tokenInDetails?.symbol === 'INVALID'}
            >
              {isApproving ? 'Approving...' : 'Approve'}
            </button>
          )}
          
          <button 
            className="px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-semibold rounded-xl transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex-1"
            onClick={executeSwap}
            disabled={
              isSwapping || 
              !swapDetails.tokenIn || 
              !swapDetails.tokenOut || 
              !swapDetails.amountIn ||
              tokenInDetails?.symbol === 'INVALID' ||
              tokenOutDetails?.symbol === 'INVALID' ||
              estimatedOutput === 'No liquidity available' ||
              estimatedOutput === 'Unable to estimate'
            }
          >
            {isSwapping ? 'Swapping...' : 'Swap'}
          </button>
        </div>

        {/* Error Messages */}
        {swapError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <div className="text-red-400 text-sm">{swapError}</div>
          </div>
        )}
      </div>

      {/* Transaction Details */}
      {currentTransaction && (
        <div className="bg-black/20 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
          {renderTransactionDetails(currentTransaction)}
        </div>
      )}
    </div>
  );
} 