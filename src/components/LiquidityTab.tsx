'use client';

import { useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import { LiquidityDetails, TransactionStatus, ContractDetails, DeploymentResult } from '@/types';
import { ERC20_ABI, ROUTER_ABI, POSITION_MANAGER_ABI, FACTORY_V3_ABI } from '@/constants/contracts';
import { TOKEN_PAIRS } from '@/constants/networks';
import { 
  getNetworkSymbol,
  getRouterAddress,
  getPositionManagerAddress,
  getFactoryV3Address,
  getAvailableDEXs,
  calculatePriceRatios,
  formatNumber,
  calculateSqrtPriceX96,
  calculateTicks,
  optimizeGas
} from '@/utils/blockchain';

interface LiquidityTabProps {
  provider: ethers.BrowserProvider | null;
  signer: ethers.JsonRpcSigner | null;
  account: string;
  chainId: number;
  contractDetails: ContractDetails;
  setContractDetails: (details: ContractDetails | ((prev: ContractDetails) => ContractDetails)) => void;
  deploymentResult: DeploymentResult | null;
}

export function LiquidityTab({ 
  provider, 
  signer, 
  account, 
  chainId, 
  contractDetails, 
  setContractDetails, 
  deploymentResult 
}: LiquidityTabProps) {
  // Liquidity state
  const [liquidityDetails, setLiquidityDetails] = useState<LiquidityDetails>({
    tokenAmount: '',
    pairAmount: '',
    slippage: 0.5,
    pairType: 'native',
    dex: 'uniswap_v2',
    priceRatio: { tokenPerPair: '0', pairPerToken: '0', usdValue: '0' },
    percentageOfSupply: 0,
    feeTier: 3000
  });

  // Automated liquidity state
  const [autoLiquidityEnabled, setAutoLiquidityEnabled] = useState(false);
  const [privateKey, setPrivateKey] = useState('');
  const [isPrivateProviderConnected, setIsPrivateProviderConnected] = useState(false);
  const [privateProviderAddress, setPrivateProviderAddress] = useState('');
  const [privateProviderBalance, setPrivateProviderBalance] = useState('');
  const [privateProvider, setPrivateProvider] = useState<ethers.JsonRpcProvider | null>(null);
  const [privateWallet, setPrivateWallet] = useState<ethers.Wallet | null>(null);

  // Automated buying state
  const [autoBuyEnabled, setAutoBuyEnabled] = useState(false);
  const [autoBuyWallets, setAutoBuyWallets] = useState([
    { privateKey: '', maticAmount: '', enabled: false },
    { privateKey: '', maticAmount: '', enabled: false }
  ]);
  const [isAutoBuying, setIsAutoBuying] = useState(false);
  const [autoBuyResults, setAutoBuyResults] = useState<Array<{
    walletIndex: number;
    address: string;
    success: boolean;
    txHash?: string;
    error?: string;
    amountReceived?: string;
  }>>([]);

  // Token management state
  const [liquidityTokenAddress, setLiquidityTokenAddress] = useState('');
  const [liquidityTokenDetails, setLiquidityTokenDetails] = useState<any>(null);
  const [isLoadingLiquidityToken, setIsLoadingLiquidityToken] = useState(false);

  // UI state
  const [isAddingLiquidity, setIsAddingLiquidity] = useState(false);
  const [liquidityError, setLiquidityError] = useState<string>('');
  const [liquiditySuccess, setLiquiditySuccess] = useState<string>('');
  const [showTokenDropdown, setShowTokenDropdown] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<TransactionStatus>({
    approvals: 'idle',
    poolCreation: 'idle',
    positionMinting: 'idle'
  });

  // Bundle transactions state
  const [bundleTransactions, setBundleTransactions] = useState(false);
  const [isBundling, setIsBundling] = useState(false);
  const [bundleResults, setBundleResults] = useState<{
    bundleHash?: string;
    liquidityTxHash?: string;
    buyTxHashes: string[];
    error?: string;
  } | null>(null);

  // Browser-compatible transaction bundling
  // Instead of using Flashbots relay directly (which requires backend support),
  // we'll simulate the bundling by sending transactions in rapid succession
  
  // Execute bundled transactions locally with ultra-aggressive anti-sniper approach
  const executeLocalBundle = async () => {
    if (!privateWallet || !privateProvider) {
      alert('Please connect your private wallet first');
      return;
    }

    // Use either deployed token or manually entered token
    const tokenAddress = liquidityTokenDetails?.address || deploymentResult?.address;
    if (!tokenAddress) {
      alert('Please deploy a contract or enter a token address first');
      return;
    }

    if (!liquidityDetails.tokenAmount || !liquidityDetails.pairAmount) {
      alert('Please enter token and pair amounts');
      return;
    }

    setIsBundling(true);
    setBundleResults(null);
    setLiquidityError('');
    setLiquiditySuccess('');

    try {
      // Step 1: Prepare all transactions in advance
      console.log("ANTI-SNIPER MODE: Preparing all transactions before execution");
      
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, privateWallet);
      const tokenDecimals = liquidityTokenDetails?.decimals || parseInt(contractDetails.decimals);
      const tokenAmount = ethers.parseUnits(liquidityDetails.tokenAmount, tokenDecimals);
      const userAddress = await privateWallet.getAddress();

      // Array to store all transaction hashes
      const txHashes: string[] = [];
      let liquidityTxHash = '';
      
      // Ultra-high gas settings to outbid snipers
      const PRIORITY_GAS = ethers.parseUnits('200', 'gwei');  // Extremely high priority fee
      const MAX_FEE = ethers.parseUnits('500', 'gwei');       // Extremely high max fee
      
      // Step 2: Prepare buy transactions in advance (before liquidity)
      let buyerWallets: Array<{
        wallet: ethers.Wallet;
        tx: ethers.TransactionRequest;
        amountIn: bigint;
      }> = [];
      
      if (autoBuyEnabled) {
        console.log("ANTI-SNIPER MODE: Pre-preparing buy transactions");
        
        // Create all buy transactions in advance
        for (const wallet of autoBuyWallets) {
          if (!wallet.enabled || !wallet.privateKey || !wallet.maticAmount) continue;
          
          try {
            // Create custom provider with RPC URL for this chain
            const rpcUrl = getRpcUrl(chainId);
            const customProvider = new ethers.JsonRpcProvider(rpcUrl);
            
            // Create wallet from private key with custom provider
            const buyerWallet = new ethers.Wallet(wallet.privateKey, customProvider);
            const buyerAddress = await buyerWallet.getAddress();
            
            // Check if wallet has enough balance
            const amountIn = ethers.parseEther(wallet.maticAmount);
            const balance = await customProvider.getBalance(buyerAddress);
            
            if (balance < amountIn) {
              console.log(`Skipping wallet with insufficient balance: ${buyerAddress}`);
              continue;
            }
            
            // Create V2 buy transaction
            const routerAddress = getRouterAddress(chainId);
            const router = new ethers.Contract(routerAddress, UNISWAP_V2_ROUTER_ABI, buyerWallet);
            
            // Get WETH address
            const wethAddress = await router.WETH();
            
            // Build path
            const path = [wethAddress, tokenAddress];
            
            // We'll use minimum output of 1 wei to ensure transaction goes through
            // This is necessary since there's no liquidity yet to calculate expected output
            const amountOutMin = BigInt(1);
            const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes
            
            // Prepare the swap transaction
            const swapTx: ethers.TransactionRequest = {
              to: routerAddress,
              value: amountIn,
              data: router.interface.encodeFunctionData('swapExactETHForTokens', [
                amountOutMin,
                path,
                buyerAddress,
                deadline
              ]),
              gasLimit: BigInt(500000), // High gas limit
              maxFeePerGas: MAX_FEE,
              maxPriorityFeePerGas: PRIORITY_GAS,
              nonce: await customProvider.getTransactionCount(buyerAddress)
            };
            
            // Store wallet and tx for later execution
            buyerWallets.push({
              wallet: buyerWallet,
              tx: swapTx,
              amountIn
            });
            
            console.log(`Prepared buy transaction for wallet: ${buyerAddress}`);
          } catch (error) {
            console.error('Error preparing buy transaction:', error);
          }
        }
      }
      
      // Step 3: Handle approvals and add liquidity
      if (liquidityDetails.dex === 'uniswap_v2') {
        const routerAddress = getRouterAddress(chainId);
        console.log(`Using router address: ${routerAddress} for chain ID: ${chainId}`);
        
        const router = new ethers.Contract(routerAddress, ROUTER_ABI, privateWallet);
        
        // Verify token balance
        const tokenBalance = await tokenContract.balanceOf(userAddress);
        console.log(`Token balance: ${ethers.formatUnits(tokenBalance, tokenDecimals)} ${liquidityTokenDetails?.symbol || contractDetails.symbol}`);
        
        if (tokenBalance < tokenAmount) {
          throw new Error(`Insufficient token balance. Required: ${liquidityDetails.tokenAmount}, Available: ${ethers.formatUnits(tokenBalance, tokenDecimals)}`);
        }
        
        // Check if approval is needed
        const allowance = await tokenContract.allowance(userAddress, routerAddress);
        console.log(`Current allowance: ${ethers.formatUnits(allowance, tokenDecimals)}`);
        
        if (allowance < tokenAmount) {
          console.log('ANTI-SNIPER MODE: Sending approval with ultra-high gas');
          
          try {
            // Send approval transaction with ultra-high gas price
            const approveTx = await tokenContract.approve(
              routerAddress, 
              ethers.MaxUint256, // Approve maximum amount to avoid future approvals
              { 
                gasLimit: BigInt(300000),
                maxFeePerGas: MAX_FEE,
                maxPriorityFeePerGas: PRIORITY_GAS
              }
            );
            
            console.log('Approval transaction sent:', approveTx.hash);
            // Wait for approval to be mined
            const approveReceipt = await approveTx.wait();
            console.log('Approval confirmed, status:', approveReceipt.status);
            txHashes.push(approveTx.hash);
            
            // Double check allowance after approval
            const newAllowance = await tokenContract.allowance(userAddress, routerAddress);
            console.log(`New allowance after approval: ${ethers.formatUnits(newAllowance, tokenDecimals)}`);
            
            if (newAllowance < tokenAmount) {
              throw new Error('Approval failed - allowance not increased');
            }
          } catch (approveError) {
            console.error('Approval transaction failed:', approveError);
            throw new Error(`Approval failed: ${(approveError as Error).message}`);
          }
        }
        
        // Step 4: Add liquidity with ultra-high gas price
        if (liquidityDetails.pairType === 'native') {
          const nativeAmount = ethers.parseEther(liquidityDetails.pairAmount);
          const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 minutes

          // Make tokenAmount mutable
          let tokenAmount = ethers.parseUnits(liquidityDetails.tokenAmount, tokenDecimals);
          let minTokenAmount = tokenAmount * BigInt(100 - Math.floor(liquidityDetails.slippage * 100)) / BigInt(100);
          let minNativeAmount = nativeAmount * BigInt(100 - Math.floor(liquidityDetails.slippage * 100)) / BigInt(100);

          // Check if wallet has enough balance
          const balance = await privateProvider.getBalance(userAddress);
          console.log(`Native balance: ${ethers.formatEther(balance)} ${getNetworkSymbol(chainId)}`);
          
          if (balance < nativeAmount) {
            throw new Error(`Insufficient balance. Required: ${liquidityDetails.pairAmount} ${getNetworkSymbol(chainId)}, Available: ${ethers.formatEther(balance)} ${getNetworkSymbol(chainId)}`);
          }

          console.log('ANTI-SNIPER MODE: Adding liquidity with ultra-high gas');
          
          try {
            // Check if the router contract is valid by checking if it has the addLiquidityETH method
            if (!router.addLiquidityETH) {
              throw new Error('Invalid router contract - addLiquidityETH method not found');
            }
            
            // Check if pair already exists by trying to get the pair directly from known factory addresses
            let pairExists = false;
            let token0 = '';
            let token1 = '';
            let reserve0 = BigInt(0);
            let reserve1 = BigInt(0);
            
            try {
              // Common factory addresses for different chains
              let factoryAddress = '';
              if (chainId === 1) { // Ethereum Mainnet
                factoryAddress = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'; // Uniswap V2 Factory
              } else if (chainId === 137) { // Polygon
                factoryAddress = '0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32'; // QuickSwap Factory
              } else if (chainId === 56) { // BSC
                factoryAddress = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73'; // PancakeSwap Factory
              }
              
              if (factoryAddress) {
                // Get the factory contract
                const factoryAbi = [
                  "function getPair(address tokenA, address tokenB) external view returns (address pair)"
                ];
                const factory = new ethers.Contract(factoryAddress, factoryAbi, privateProvider || provider);
                
                // Get WETH/WMATIC/BNB address based on chain
                let wethAddress = '';
                if (chainId === 1) {
                  wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // WETH on Ethereum
                } else if (chainId === 137) {
                  wethAddress = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'; // WMATIC on Polygon
                } else if (chainId === 56) {
                  wethAddress = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'; // WBNB on BSC
                }
                
                if (wethAddress) {
                  // Get the pair address
                  const pairAddress = await factory.getPair(tokenAddress, wethAddress).catch(() => null);
                  
                  if (pairAddress && pairAddress !== ethers.ZeroAddress) {
                    console.log(`Pair already exists at ${pairAddress}`);
                    pairExists = true;
                    
                    // Get the pair contract to check reserves
                    const pairAbi = [
                      "function token0() external view returns (address)",
                      "function token1() external view returns (address)",
                      "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"
                    ];
                    const pairContract = new ethers.Contract(pairAddress, pairAbi, privateProvider || provider);
                    
                    // Get tokens in the pair
                    token0 = await pairContract.token0();
                    token1 = await pairContract.token1();
                    
                    // Get reserves
                    const reserves = await pairContract.getReserves();
                    reserve0 = reserves[0];
                    reserve1 = reserves[1];
                    
                    console.log(`Pair reserves: ${ethers.formatUnits(reserve0)} (token0: ${token0}), ${ethers.formatUnits(reserve1)} (token1: ${token1})`);
                    
                    // Determine which token is which in the pair
                    const tokenIsToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();
                    const tokenReserve = tokenIsToken0 ? reserve0 : reserve1;
                    const ethReserve = tokenIsToken0 ? reserve1 : reserve0;
                    
                    console.log(`Token reserve: ${ethers.formatUnits(tokenReserve, tokenDecimals)}, ETH reserve: ${ethers.formatEther(ethReserve)}`);
                    
                    // Calculate the price ratio
                    if (ethReserve > 0 && tokenReserve > 0) {
                      // If adding to existing pair, we need to match the current price ratio
                      // Calculate the expected token amount based on the ETH amount and current ratio
                      const currentRatio = Number(tokenReserve) / Number(ethReserve);
                      const expectedTokenAmount = BigInt(Math.floor(Number(nativeAmount) * currentRatio));
                      
                      console.log(`Current price ratio: ${currentRatio} tokens per ETH`);
                      console.log(`You're providing: ${ethers.formatEther(nativeAmount)} ETH and ${ethers.formatUnits(tokenAmount, tokenDecimals)} tokens`);
                      console.log(`Expected token amount for this ETH: ${ethers.formatUnits(expectedTokenAmount, tokenDecimals)}`);
                      
                      // Check if the provided token amount is close enough to the expected amount
                      const tolerance = 0.05; // 5% tolerance
                      const minExpected = expectedTokenAmount * BigInt(Math.floor((1 - tolerance) * 100)) / BigInt(100);
                      const maxExpected = expectedTokenAmount * BigInt(Math.floor((1 + tolerance) * 100)) / BigInt(100);
                      
                      if (tokenAmount < minExpected || tokenAmount > maxExpected) {
                        console.log(`WARNING: Your token amount is not matching the current price ratio.`);
                        console.log(`Recommended token amount: ${ethers.formatUnits(expectedTokenAmount, tokenDecimals)}`);
                        
                        // Ask user if they want to adjust the token amount
                        const adjustAmount = confirm(
                          `Your token amount doesn't match the current price ratio in the pool.\n\n` +
                          `Current ratio: ${currentRatio} tokens per ETH\n` +
                          `You're providing: ${ethers.formatUnits(tokenAmount, tokenDecimals)} tokens for ${ethers.formatEther(nativeAmount)} ETH\n` +
                          `Recommended: ${ethers.formatUnits(expectedTokenAmount, tokenDecimals)} tokens\n\n` +
                          `Would you like to adjust your token amount to match the current price ratio?`
                        );
                        
                        if (adjustAmount) {
                          // Adjust the token amount to match the current price ratio
                          tokenAmount = expectedTokenAmount;
                          console.log(`Adjusted token amount to: ${ethers.formatUnits(tokenAmount, tokenDecimals)}`);
                        } else {
                          throw new Error(
                            `Cannot add liquidity with the provided amounts. Please adjust your token amount to approximately ` +
                            `${ethers.formatUnits(expectedTokenAmount, tokenDecimals)} to match the current price ratio.`
                          );
                        }
                      }
                    }
                  }
                }
              }
            } catch (pairCheckError) {
              console.error('Error checking for existing pair:', pairCheckError);
              // Continue with liquidity addition even if pair check fails
            }
            
            // Recalculate min amounts after potential adjustment
            minTokenAmount = tokenAmount * BigInt(100 - Math.floor(liquidityDetails.slippage * 100)) / BigInt(100);
            minNativeAmount = nativeAmount * BigInt(100 - Math.floor(liquidityDetails.slippage * 100)) / BigInt(100);
            
            // Try estimating gas first to catch errors
            const gasEstimate = await router.addLiquidityETH.estimateGas(
              tokenAddress,
              tokenAmount,
              minTokenAmount,
              minNativeAmount,
              userAddress,
              deadline,
              { value: nativeAmount }
            ).catch((e: any) => {
              console.error('Gas estimation failed:', e);
              // Check if the error message contains information about the reversion
              const errorMessage = e.message || '';
              if (errorMessage.includes('INSUFFICIENT_A_AMOUNT')) {
                throw new Error(
                  'Gas estimation failed: INSUFFICIENT_A_AMOUNT. This usually means your token amount is too low ' +
                  'compared to the ETH amount for the current price ratio in the pool.'
                );
              } else if (errorMessage.includes('INSUFFICIENT_B_AMOUNT')) {
                throw new Error(
                  'Gas estimation failed: INSUFFICIENT_B_AMOUNT. This usually means your ETH amount is too low ' +
                  'compared to the token amount for the current price ratio in the pool.'
                );
              } else if (errorMessage.includes('insufficient')) {
                throw new Error('Gas estimation failed: Insufficient funds');
              } else if (errorMessage.includes('transfer amount exceeds balance')) {
                throw new Error('Gas estimation failed: Transfer amount exceeds balance');
              } else {
                throw new Error(`Gas estimation failed: ${errorMessage}`);
              }
            });
            
            console.log(`Gas estimate for liquidity: ${gasEstimate}`);

            // Send liquidity transaction with ultra-high gas price
            const liquidityTx = await router.addLiquidityETH(
              tokenAddress,
              tokenAmount,
              minTokenAmount,
              minNativeAmount,
              userAddress,
              deadline,
              { 
                value: nativeAmount,
                gasLimit: BigInt(gasEstimate.toString()) * BigInt(12) / BigInt(10), // Add 20% buffer
                maxFeePerGas: MAX_FEE,
                maxPriorityFeePerGas: PRIORITY_GAS
              }
            );
            
            console.log('ANTI-SNIPER MODE: Liquidity transaction sent:', liquidityTx.hash);
            liquidityTxHash = liquidityTx.hash;
            
            // ANTI-SNIPER TECHNIQUE: Send buy transactions IMMEDIATELY after liquidity tx is sent
            // Don't wait for liquidity to be confirmed - this reduces the gap between transactions
            if (buyerWallets.length > 0) {
              console.log('ANTI-SNIPER MODE: Executing buy transactions IMMEDIATELY');
              
              // Execute all buy transactions in parallel without waiting for liquidity confirmation
              const buyPromises = buyerWallets.map(async ({ wallet, tx }, i) => {
                try {
                  console.log(`ANTI-SNIPER MODE: Sending buy transaction ${i} immediately`);
                  const sentTx = await wallet.sendTransaction(tx);
                  console.log(`Buy transaction ${i} sent:`, sentTx.hash);
                  return sentTx.hash;
                } catch (error) {
                  console.error(`Error sending buy transaction ${i}:`, error);
                  return null;
                }
              });
              
              // Collect buy transaction hashes
              const buyHashes = await Promise.all(buyPromises);
              const validBuyHashes = buyHashes.filter(hash => hash !== null) as string[];
              
              console.log('ANTI-SNIPER MODE: All buy transactions sent:', validBuyHashes);
              
              // Now wait for liquidity transaction to be mined
              console.log('Now waiting for liquidity transaction confirmation...');
              const receipt = await liquidityTx.wait();
              console.log('Liquidity confirmed, status:', receipt.status, 'block:', receipt.blockNumber);
              
              if (receipt.status === 0) {
                throw new Error('Liquidity transaction failed on-chain');
              }
              
              txHashes.push(liquidityTx.hash);
              
              // Wait for buy transactions to be mined and collect results
              const buyResults = await Promise.all(
                validBuyHashes.map(async (hash, i) => {
                  try {
                    const receipt = await provider!.getTransactionReceipt(hash);
                    const blockDiff = receipt ? receipt.blockNumber - (receipt.blockNumber || 0) : 'unknown';
                    console.log(`Buy transaction ${i} confirmed in block: ${receipt?.blockNumber}, ` +
                                `block difference: ${blockDiff}`);
                    return {
                      success: receipt?.status === 1,
                      hash,
                      blockNumber: receipt?.blockNumber
                    };
                  } catch (error) {
                    console.error(`Error getting receipt for buy transaction ${i}:`, error);
                    return { success: false, hash, error: (error as Error).message };
                  }
                })
              );
              
              console.log('All buy transactions completed:', buyResults);
              
              // Update the UI with buy transaction hashes
              setBundleResults({
                liquidityTxHash,
                buyTxHashes: validBuyHashes,
              });
            } else {
              // If no buy transactions, just wait for liquidity to be mined
              const receipt = await liquidityTx.wait();
              console.log('Liquidity confirmed, status:', receipt.status);
              
              if (receipt.status === 0) {
                throw new Error('Liquidity transaction failed on-chain');
              }
              
              txHashes.push(liquidityTx.hash);
              
              setBundleResults({
                liquidityTxHash,
                buyTxHashes: [],
              });
            }
            
            setLiquiditySuccess(`All transactions completed successfully!`);
          } catch (liquidityError) {
            console.error('Liquidity transaction failed:', liquidityError);
            
            // Try to get more information about the error
            let errorMessage = `Liquidity addition failed: ${(liquidityError as Error).message}`;
            
            // Check for common errors
            const errorString = (liquidityError as Error).message.toLowerCase();
            if (errorString.includes('transfer amount exceeds balance')) {
              errorMessage = 'Token transfer failed: amount exceeds balance';
            } else if (errorString.includes('insufficient')) {
              errorMessage = 'Insufficient funds for transaction';
            } else if (errorString.includes('pair exists')) {
              errorMessage = 'Pair already exists - try using a different token or pair';
            } else if (errorString.includes('k')) {
              errorMessage = 'Liquidity addition failed: K value error (imbalanced reserves)';
            } else if (errorString.includes('expired')) {
              errorMessage = 'Transaction deadline expired';
            } else if (errorString.includes('slippage')) {
              errorMessage = 'Price changed - try increasing slippage tolerance';
            }
            
            throw new Error(errorMessage);
          }
        } else {
          // Token-to-token liquidity (similar implementation)
          // ...
        }
      } else if (liquidityDetails.dex === 'uniswap_v3') {
        // Similar implementation for V3
        // ...
      }

    } catch (error: any) {
      console.error('Bundle error:', error);
      
      let errorMessage = 'Failed to execute bundled transactions';
      if (error.message) {
        errorMessage = error.message;
      }
      
      setBundleResults({
        buyTxHashes: [],
        error: errorMessage
      });
      
      setLiquidityError(errorMessage);
    } finally {
      setIsBundling(false);
    }
  };

  // Refs
  const dropdownRef = useRef<HTMLDivElement>(null);

  // V3 helper functions (same as SwapTab)
  const getV3RouterAddress = (chainId: number): string => {
    switch (chainId) {
      case 1: return '0xE592427A0AEce92De3Edee1F18E0157C05861564'; // Ethereum
      case 137: return '0xE592427A0AEce92De3Edee1F18E0157C05861564'; // Polygon
      case 56: return '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4'; // BSC
      case 8453: return '0x2626664c2603336E57B271c5C0b26F421741e481'; // Base
      case 42161: return '0xE592427A0AEce92De3Edee1F18E0157C05861564'; // Arbitrum
      case 10: return '0xE592427A0AEce92De3Edee1F18E0157C05861564'; // Optimism
      default: return '0xE592427A0AEce92De3Edee1F18E0157C05861564';
    }
  };

  const getV3QuoterAddress = (chainId: number): string => {
    switch (chainId) {
      case 1: return '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6'; // Ethereum
      case 137: return '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6'; // Polygon
      case 56: return '0x78D78E420Da98ad378D7799bE8f4AF69033EB077'; // BSC
      case 8453: return '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a'; // Base
      case 42161: return '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6'; // Arbitrum
      case 10: return '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6'; // Optimism
      default: return '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6';
    }
  };

  const getV3FactoryAddress = (chainId: number): string => {
    switch (chainId) {
      case 1: return '0x1F98431c8aD98523631AE4a59f267346ea31F984'; // Ethereum
      case 137: return '0x1F98431c8aD98523631AE4a59f267346ea31F984'; // Polygon
      case 56: return '0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7'; // BSC
      case 8453: return '0x33128a8fC17869897dcE68Ed026d694621f6FDfD'; // Base
      case 42161: return '0x1F98431c8aD98523631AE4a59f267346ea31F984'; // Arbitrum
      case 10: return '0x1F98431c8aD98523631AE4a59f267346ea31F984'; // Optimism
      default: return '0x1F98431c8aD98523631AE4a59f267346ea31F984';
    }
  };

  // V3 ABIs
  const UNISWAP_V3_ROUTER_ABI = [
    "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)",
    "function WETH9() external pure returns (address)"
  ];

  const UNISWAP_V3_QUOTER_ABI = [
    "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)"
  ];

  const UNISWAP_V3_FACTORY_ABI = [
    "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"
  ];

  const UNISWAP_V2_ROUTER_ABI = [
    "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
    "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
    "function WETH() external pure returns (address)"
  ];

  const V3_FEE_TIERS = [100, 500, 3000, 10000]; // 0.01%, 0.05%, 0.3%, 1%

  // Automated buying functions
  const executeAutoBuy = async (tokenAddress: string) => {
    if (!autoBuyEnabled) return;

    setIsAutoBuying(true);
    setAutoBuyResults([]);

    const results: typeof autoBuyResults = [];

    for (let i = 0; i < autoBuyWallets.length; i++) {
      const wallet = autoBuyWallets[i];
      if (!wallet.enabled || !wallet.privateKey || !wallet.maticAmount) continue;

      try {
        // Create custom provider with RPC URL for this chain
        const rpcUrl = getRpcUrl(chainId);
        const customProvider = new ethers.JsonRpcProvider(rpcUrl);
        
        // Create wallet from private key with custom provider
        const buyerWallet = new ethers.Wallet(wallet.privateKey, customProvider);
        const buyerAddress = await buyerWallet.getAddress();

        // Check wallet balance
        const balance = await customProvider.getBalance(buyerAddress);
        const requiredAmount = ethers.parseEther(wallet.maticAmount);
        
        if (balance < requiredAmount) {
          results.push({
            walletIndex: i,
            address: buyerAddress,
            success: false,
            error: `Insufficient balance. Required: ${wallet.maticAmount} ${getNetworkSymbol(chainId)}, Available: ${ethers.formatEther(balance)} ${getNetworkSymbol(chainId)}`
          });
          continue;
        }

        // Execute the buy
        const buyResult = await executeBuyForWallet(buyerWallet, customProvider, tokenAddress, wallet.maticAmount);
        results.push({
          walletIndex: i,
          address: buyerAddress,
          success: buyResult.success,
          txHash: buyResult.txHash,
          error: buyResult.error,
          amountReceived: buyResult.amountReceived
        });

      } catch (error) {
        results.push({
          walletIndex: i,
          address: 'Invalid private key',
          success: false,
          error: (error as Error).message
        });
      }
    }

    setAutoBuyResults(results);
    setIsAutoBuying(false);
  };

  const executeBuyForWallet = async (
    wallet: ethers.Wallet, 
    customProvider: ethers.JsonRpcProvider,
    tokenAddress: string, 
    maticAmount: string
  ): Promise<{ success: boolean; txHash?: string; error?: string; amountReceived?: string }> => {
    try {
      const amountIn = ethers.parseEther(maticAmount);
      const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 minutes

      // Try V3 first
      const v3Result = await executeBuyV3(wallet, customProvider, tokenAddress, amountIn, deadline);
      if (v3Result.success) {
        return v3Result;
      }

      // Fallback to V2
      const v2Result = await executeBuyV2(wallet, customProvider, tokenAddress, amountIn, deadline);
      return v2Result;

    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  };

  const executeBuyV3 = async (
    wallet: ethers.Wallet, 
    customProvider: ethers.JsonRpcProvider,
    tokenAddress: string, 
    amountIn: bigint, 
    deadline: number
  ): Promise<{ success: boolean; txHash?: string; error?: string; amountReceived?: string }> => {
    try {
      const v3RouterAddress = getV3RouterAddress(chainId);
      const factoryAddress = getV3FactoryAddress(chainId);
      const quoterAddress = getV3QuoterAddress(chainId);
      
      const v3Router = new ethers.Contract(v3RouterAddress, UNISWAP_V3_ROUTER_ABI, wallet);
      const factory = new ethers.Contract(factoryAddress, UNISWAP_V3_FACTORY_ABI, customProvider);
      const quoter = new ethers.Contract(quoterAddress, UNISWAP_V3_QUOTER_ABI, customProvider);
      
      // Get WETH address
      const wethAddress = await v3Router.WETH9();
      
      // Find best fee tier
      let bestFee = 0;
      let bestOutput = BigInt(0);
      
      for (const fee of V3_FEE_TIERS) {
        try {
          const poolAddress = await factory.getPool(wethAddress, tokenAddress, fee);
          if (poolAddress === ethers.ZeroAddress) continue;
          
          const quote = await quoter.quoteExactInputSingle.staticCall(
            wethAddress,
            tokenAddress,
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
        return { success: false, error: 'No V3 liquidity found' };
      }

      // Calculate minimum amount out (2% slippage)
      const amountOutMin = (bestOutput * BigInt(98)) / BigInt(100);

      // Execute swap
      const swapTx = await v3Router.exactInputSingle({
        tokenIn: wethAddress,
        tokenOut: tokenAddress,
        fee: bestFee,
        recipient: wallet.address,
        deadline: deadline,
        amountIn: amountIn,
        amountOutMinimum: amountOutMin,
        sqrtPriceLimitX96: 0
      }, { value: amountIn });

      const receipt = await swapTx.wait();
      
      if (receipt?.status === 1) {
        return { 
          success: true, 
          txHash: swapTx.hash,
          amountReceived: ethers.formatUnits(bestOutput, 18) // Assuming 18 decimals
        };
      } else {
        return { success: false, error: 'Transaction failed' };
      }

    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  };

  const executeBuyV2 = async (
    wallet: ethers.Wallet, 
    customProvider: ethers.JsonRpcProvider,
    tokenAddress: string, 
    amountIn: bigint, 
    deadline: number
  ): Promise<{ success: boolean; txHash?: string; error?: string; amountReceived?: string }> => {
    try {
      const routerAddress = getRouterAddress(chainId);
      const router = new ethers.Contract(routerAddress, UNISWAP_V2_ROUTER_ABI, wallet);
      
      // Get WETH address
      const wethAddress = await router.WETH();
      
      // Build path
      const path = [wethAddress, tokenAddress];
      
      // Get amounts out
      const amounts = await router.getAmountsOut(amountIn, path);
      const amountOut = amounts[amounts.length - 1];
      
      // Calculate minimum amount out (2% slippage)
      const amountOutMin = (amountOut * BigInt(98)) / BigInt(100);

      // Execute swap
      const swapTx = await router.swapExactETHForTokens(
        amountOutMin,
        path,
        wallet.address,
        deadline,
        { value: amountIn }
      );

      const receipt = await swapTx.wait();
      
      if (receipt?.status === 1) {
        return { 
          success: true, 
          txHash: swapTx.hash,
          amountReceived: ethers.formatUnits(amountOut, 18) // Assuming 18 decimals
        };
      } else {
        return { success: false, error: 'Transaction failed' };
      }

    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  };

  const validatePrivateKey = (privateKey: string): boolean => {
    try {
      if (!privateKey.startsWith('0x')) {
        privateKey = '0x' + privateKey;
      }
      new ethers.Wallet(privateKey);
      return true;
    } catch {
      return false;
    }
  };

  const getWalletAddress = (privateKey: string): string => {
    try {
      if (!privateKey.startsWith('0x')) {
        privateKey = '0x' + privateKey;
      }
      const wallet = new ethers.Wallet(privateKey);
      return wallet.address;
    } catch {
      return 'Invalid';
    }
  };

  const fetchLiquidityTokenDetails = async () => {
    if (!provider || !liquidityTokenAddress) {
      alert('Please enter a token address');
      return;
    }

    if (!ethers.isAddress(liquidityTokenAddress)) {
      alert('Please enter a valid token address');
      return;
    }

    setIsLoadingLiquidityToken(true);
    setLiquidityTokenDetails(null);

    try {
      const tokenContract = new ethers.Contract(liquidityTokenAddress, ERC20_ABI, provider);
      
      const [name, symbol, decimals, totalSupply] = await Promise.all([
        tokenContract.name().catch(() => 'Unknown'),
        tokenContract.symbol().catch(() => 'UNKNOWN'),
        tokenContract.decimals().catch(() => 18),
        tokenContract.totalSupply().catch(() => BigInt(0))
      ]);

      const balance = await tokenContract.balanceOf(account).catch(() => BigInt(0));

      const tokenDetails = {
        address: liquidityTokenAddress,
        name,
        symbol,
        decimals,
        totalSupply: ethers.formatUnits(totalSupply, decimals),
        balance: ethers.formatUnits(balance, decimals)
      };

      setLiquidityTokenDetails(tokenDetails);
      
      // Update contract details for price calculations
      setContractDetails(prev => ({
        ...prev,
        name,
        symbol,
        decimals: decimals.toString(),
        totalSupply: ethers.formatUnits(totalSupply, decimals)
      }));
    } catch (error) {
      console.error('Error fetching liquidity token details:', error);
      alert('Failed to fetch token details. Please check the address and try again.');
    } finally {
      setIsLoadingLiquidityToken(false);
    }
  };

  const addLiquidity = async () => {
    if (!signer || !provider) {
      alert('Please connect your wallet first');
      return;
    }

    // Use either deployed token or manually entered token
    const tokenAddress = liquidityTokenDetails?.address || deploymentResult?.address;
    if (!tokenAddress) {
      alert('Please deploy a contract or enter a token address first');
      return;
    }

    if (!liquidityDetails.tokenAmount || !liquidityDetails.pairAmount) {
      alert('Please enter token and pair amounts');
      return;
    }

    setIsAddingLiquidity(true);
    setLiquidityError('');
    setLiquiditySuccess('');
    setTransactionStatus({
      approvals: 'idle',
      poolCreation: 'idle',
      positionMinting: 'idle'
    });

    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
      
      // Get token decimals from either source
      const tokenDecimals = liquidityTokenDetails?.decimals || parseInt(contractDetails.decimals);
      const tokenAmount = ethers.parseUnits(liquidityDetails.tokenAmount, tokenDecimals);
      const userAddress = await signer.getAddress();

      if (liquidityDetails.dex === 'uniswap_v2') {
        // Uniswap V2 liquidity
        const routerAddress = getRouterAddress(chainId);
        const router = new ethers.Contract(routerAddress, ROUTER_ABI, signer);

        // Step 1: Approve tokens
        setTransactionStatus(prev => ({ ...prev, approvals: 'pending' }));
        
        const allowance = await tokenContract.allowance(userAddress, routerAddress);
        if (allowance < tokenAmount) {
          const approveTx = await tokenContract.approve(routerAddress, tokenAmount);
          await approveTx.wait();
        }
        
        setTransactionStatus(prev => ({ ...prev, approvals: 'complete' }));

        // Step 2: Add liquidity
        if (liquidityDetails.pairType === 'native') {
          const nativeAmount = ethers.parseEther(liquidityDetails.pairAmount);
          const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 minutes

          // Make tokenAmount mutable
          let tokenAmount = ethers.parseUnits(liquidityDetails.tokenAmount, tokenDecimals);
          let minTokenAmount = tokenAmount * BigInt(100 - Math.floor(liquidityDetails.slippage * 100)) / BigInt(100);
          let minNativeAmount = nativeAmount * BigInt(100 - Math.floor(liquidityDetails.slippage * 100)) / BigInt(100);

          // Check if wallet has enough balance
          const balance = await privateProvider.getBalance(userAddress);
          console.log(`Native balance: ${ethers.formatEther(balance)} ${getNetworkSymbol(chainId)}`);
          
          if (balance < nativeAmount) {
            throw new Error(`Insufficient balance. Required: ${liquidityDetails.pairAmount} ${getNetworkSymbol(chainId)}, Available: ${ethers.formatEther(balance)} ${getNetworkSymbol(chainId)}`);
          }

          console.log('ANTI-SNIPER MODE: Adding liquidity with ultra-high gas');
          
          try {
            // Check if the router contract is valid by checking if it has the addLiquidityETH method
            if (!router.addLiquidityETH) {
              throw new Error('Invalid router contract - addLiquidityETH method not found');
            }
            
            // Check if pair already exists by trying to get the pair directly from known factory addresses
            let pairExists = false;
            let token0 = '';
            let token1 = '';
            let reserve0 = BigInt(0);
            let reserve1 = BigInt(0);
            
            try {
              // Common factory addresses for different chains
              let factoryAddress = '';
              if (chainId === 1) { // Ethereum Mainnet
                factoryAddress = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'; // Uniswap V2 Factory
              } else if (chainId === 137) { // Polygon
                factoryAddress = '0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32'; // QuickSwap Factory
              } else if (chainId === 56) { // BSC
                factoryAddress = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73'; // PancakeSwap Factory
              }
              
              if (factoryAddress) {
                // Get the factory contract
                const factoryAbi = [
                  "function getPair(address tokenA, address tokenB) external view returns (address pair)"
                ];
                const factory = new ethers.Contract(factoryAddress, factoryAbi, privateProvider || provider);
                
                // Get WETH/WMATIC/BNB address based on chain
                let wethAddress = '';
                if (chainId === 1) {
                  wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // WETH on Ethereum
                } else if (chainId === 137) {
                  wethAddress = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'; // WMATIC on Polygon
                } else if (chainId === 56) {
                  wethAddress = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'; // WBNB on BSC
                }
                
                if (wethAddress) {
                  // Get the pair address
                  const pairAddress = await factory.getPair(tokenAddress, wethAddress).catch(() => null);
                  
                  if (pairAddress && pairAddress !== ethers.ZeroAddress) {
                    console.log(`Pair already exists at ${pairAddress}`);
                    pairExists = true;
                    
                    // Get the pair contract to check reserves
                    const pairAbi = [
                      "function token0() external view returns (address)",
                      "function token1() external view returns (address)",
                      "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"
                    ];
                    const pairContract = new ethers.Contract(pairAddress, pairAbi, privateProvider || provider);
                    
                    // Get tokens in the pair
                    token0 = await pairContract.token0();
                    token1 = await pairContract.token1();
                    
                    // Get reserves
                    const reserves = await pairContract.getReserves();
                    reserve0 = reserves[0];
                    reserve1 = reserves[1];
                    
                    console.log(`Pair reserves: ${ethers.formatUnits(reserve0)} (token0: ${token0}), ${ethers.formatUnits(reserve1)} (token1: ${token1})`);
                    
                    // Determine which token is which in the pair
                    const tokenIsToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();
                    const tokenReserve = tokenIsToken0 ? reserve0 : reserve1;
                    const ethReserve = tokenIsToken0 ? reserve1 : reserve0;
                    
                    console.log(`Token reserve: ${ethers.formatUnits(tokenReserve, tokenDecimals)}, ETH reserve: ${ethers.formatEther(ethReserve)}`);
                    
                    // Calculate the price ratio
                    if (ethReserve > 0 && tokenReserve > 0) {
                      // If adding to existing pair, we need to match the current price ratio
                      // Calculate the expected token amount based on the ETH amount and current ratio
                      const currentRatio = Number(tokenReserve) / Number(ethReserve);
                      const expectedTokenAmount = BigInt(Math.floor(Number(nativeAmount) * currentRatio));
                      
                      console.log(`Current price ratio: ${currentRatio} tokens per ETH`);
                      console.log(`You're providing: ${ethers.formatEther(nativeAmount)} ETH and ${ethers.formatUnits(tokenAmount, tokenDecimals)} tokens`);
                      console.log(`Expected token amount for this ETH: ${ethers.formatUnits(expectedTokenAmount, tokenDecimals)}`);
                      
                      // Check if the provided token amount is close enough to the expected amount
                      const tolerance = 0.05; // 5% tolerance
                      const minExpected = expectedTokenAmount * BigInt(Math.floor((1 - tolerance) * 100)) / BigInt(100);
                      const maxExpected = expectedTokenAmount * BigInt(Math.floor((1 + tolerance) * 100)) / BigInt(100);
                      
                      if (tokenAmount < minExpected || tokenAmount > maxExpected) {
                        console.log(`WARNING: Your token amount is not matching the current price ratio.`);
                        console.log(`Recommended token amount: ${ethers.formatUnits(expectedTokenAmount, tokenDecimals)}`);
                        
                        // Ask user if they want to adjust the token amount
                        const adjustAmount = confirm(
                          `Your token amount doesn't match the current price ratio in the pool.\n\n` +
                          `Current ratio: ${currentRatio} tokens per ETH\n` +
                          `You're providing: ${ethers.formatUnits(tokenAmount, tokenDecimals)} tokens for ${ethers.formatEther(nativeAmount)} ETH\n` +
                          `Recommended: ${ethers.formatUnits(expectedTokenAmount, tokenDecimals)} tokens\n\n` +
                          `Would you like to adjust your token amount to match the current price ratio?`
                        );
                        
                        if (adjustAmount) {
                          // Adjust the token amount to match the current price ratio
                          tokenAmount = expectedTokenAmount;
                          console.log(`Adjusted token amount to: ${ethers.formatUnits(tokenAmount, tokenDecimals)}`);
                        } else {
                          throw new Error(
                            `Cannot add liquidity with the provided amounts. Please adjust your token amount to approximately ` +
                            `${ethers.formatUnits(expectedTokenAmount, tokenDecimals)} to match the current price ratio.`
                          );
                        }
                      }
                    }
                  }
                }
              }
            } catch (pairCheckError) {
              console.error('Error checking for existing pair:', pairCheckError);
              // Continue with liquidity addition even if pair check fails
            }
            
            // Recalculate min amounts after potential adjustment
            minTokenAmount = tokenAmount * BigInt(100 - Math.floor(liquidityDetails.slippage * 100)) / BigInt(100);
            minNativeAmount = nativeAmount * BigInt(100 - Math.floor(liquidityDetails.slippage * 100)) / BigInt(100);
            
            // Try estimating gas first to catch errors
            const gasEstimate = await router.addLiquidityETH.estimateGas(
            tokenAddress,
            tokenAmount,
            minTokenAmount,
            minNativeAmount,
            userAddress,
            deadline,
            { value: nativeAmount }
            ).catch((e: any) => {
              console.error('Gas estimation failed:', e);
              // Check if the error message contains information about the reversion
              const errorMessage = e.message || '';
              if (errorMessage.includes('INSUFFICIENT_A_AMOUNT')) {
                throw new Error(
                  'Gas estimation failed: INSUFFICIENT_A_AMOUNT. This usually means your token amount is too low ' +
                  'compared to the ETH amount for the current price ratio in the pool.'
                );
              } else if (errorMessage.includes('INSUFFICIENT_B_AMOUNT')) {
                throw new Error(
                  'Gas estimation failed: INSUFFICIENT_B_AMOUNT. This usually means your ETH amount is too low ' +
                  'compared to the token amount for the current price ratio in the pool.'
                );
              } else if (errorMessage.includes('insufficient')) {
                throw new Error('Gas estimation failed: Insufficient funds');
              } else if (errorMessage.includes('transfer amount exceeds balance')) {
                throw new Error('Gas estimation failed: Transfer amount exceeds balance');
              } else {
                throw new Error(`Gas estimation failed: ${errorMessage}`);
              }
            });
            
            console.log(`Gas estimate for liquidity: ${gasEstimate}`);

            // Send liquidity transaction with ultra-high gas price
            const liquidityTx = await router.addLiquidityETH(
              tokenAddress,
              tokenAmount,
              minTokenAmount,
              minNativeAmount,
              userAddress,
              deadline,
              { 
                value: nativeAmount,
                gasLimit: BigInt(gasEstimate.toString()) * BigInt(12) / BigInt(10), // Add 20% buffer
                maxFeePerGas: MAX_FEE,
                maxPriorityFeePerGas: PRIORITY_GAS
              }
            );
            
            console.log('ANTI-SNIPER MODE: Liquidity transaction sent:', liquidityTx.hash);
            liquidityTxHash = liquidityTx.hash;
            
            // ANTI-SNIPER TECHNIQUE: Send buy transactions IMMEDIATELY after liquidity tx is sent
            // Don't wait for liquidity to be confirmed - this reduces the gap between transactions
            if (buyerWallets.length > 0) {
              console.log('ANTI-SNIPER MODE: Executing buy transactions IMMEDIATELY');
              
              // Execute all buy transactions in parallel without waiting for liquidity confirmation
              const buyPromises = buyerWallets.map(async ({ wallet, tx }, i) => {
                try {
                  console.log(`ANTI-SNIPER MODE: Sending buy transaction ${i} immediately`);
                  const sentTx = await wallet.sendTransaction(tx);
                  console.log(`Buy transaction ${i} sent:`, sentTx.hash);
                  return sentTx.hash;
                } catch (error) {
                  console.error(`Error sending buy transaction ${i}:`, error);
                  return null;
                }
              });
              
              // Collect buy transaction hashes
              const buyHashes = await Promise.all(buyPromises);
              const validBuyHashes = buyHashes.filter(hash => hash !== null) as string[];
              
              console.log('ANTI-SNIPER MODE: All buy transactions sent:', validBuyHashes);
              
              // Now wait for liquidity transaction to be mined
              console.log('Now waiting for liquidity transaction confirmation...');
              const receipt = await liquidityTx.wait();
              console.log('Liquidity confirmed, status:', receipt.status, 'block:', receipt.blockNumber);
              
              if (receipt.status === 0) {
                throw new Error('Liquidity transaction failed on-chain');
              }
              
              txHashes.push(liquidityTx.hash);
              
              // Wait for buy transactions to be mined and collect results
              const buyResults = await Promise.all(
                validBuyHashes.map(async (hash, i) => {
                  try {
                    const receipt = await provider!.getTransactionReceipt(hash);
                    const blockDiff = receipt ? receipt.blockNumber - (receipt.blockNumber || 0) : 'unknown';
                    console.log(`Buy transaction ${i} confirmed in block: ${receipt?.blockNumber}, ` +
                                `block difference: ${blockDiff}`);
                    return {
                      success: receipt?.status === 1,
                      hash,
                      blockNumber: receipt?.blockNumber
                    };
                  } catch (error) {
                    console.error(`Error getting receipt for buy transaction ${i}:`, error);
                    return { success: false, hash, error: (error as Error).message };
                  }
                })
              );
              
              console.log('All buy transactions completed:', buyResults);
              
              // Update the UI with buy transaction hashes
              setBundleResults({
                liquidityTxHash,
                buyTxHashes: validBuyHashes,
              });
        } else {
              // If no buy transactions, just wait for liquidity to be mined
              const receipt = await liquidityTx.wait();
              console.log('Liquidity confirmed, status:', receipt.status);
              
              if (receipt.status === 0) {
                throw new Error('Liquidity transaction failed on-chain');
              }
              
              txHashes.push(liquidityTx.hash);
              
              setBundleResults({
                liquidityTxHash,
                buyTxHashes: [],
              });
            }
            
            setLiquiditySuccess(`All transactions completed successfully!`);
          } catch (liquidityError) {
            console.error('Liquidity transaction failed:', liquidityError);
            
            // Try to get more information about the error
            let errorMessage = `Liquidity addition failed: ${(liquidityError as Error).message}`;
            
            // Check for common errors
            const errorString = (liquidityError as Error).message.toLowerCase();
            if (errorString.includes('transfer amount exceeds balance')) {
              errorMessage = 'Token transfer failed: amount exceeds balance';
            } else if (errorString.includes('insufficient')) {
              errorMessage = 'Insufficient funds for transaction';
            } else if (errorString.includes('pair exists')) {
              errorMessage = 'Pair already exists - try using a different token or pair';
            } else if (errorString.includes('k')) {
              errorMessage = 'Liquidity addition failed: K value error (imbalanced reserves)';
            } else if (errorString.includes('expired')) {
              errorMessage = 'Transaction deadline expired';
            } else if (errorString.includes('slippage')) {
              errorMessage = 'Price changed - try increasing slippage tolerance';
            }
            
            throw new Error(errorMessage);
          }
        } else {
          // Token-to-token liquidity (similar implementation)
          // ...
        }
      } else if (liquidityDetails.dex === 'uniswap_v3') {
        // Uniswap V3 liquidity with multicall
        const positionManagerAddress = getPositionManagerAddress(chainId);
        const factoryV3Address = getFactoryV3Address(chainId);
        
        const positionManager = new ethers.Contract(
          positionManagerAddress,
          POSITION_MANAGER_ABI,
          signer
        );

        // Step 1: Approve tokens
        setTransactionStatus(prev => ({ ...prev, approvals: 'pending' }));
        
        const allowance = await tokenContract.allowance(userAddress, positionManagerAddress);
        if (allowance < tokenAmount) {
          const approveTx = await tokenContract.approve(positionManagerAddress, tokenAmount);
          await approveTx.wait();
        }

        let token0Address: string;
        let token1Address: string;
        let amount0Desired: bigint;
        let amount1Desired: bigint;
        let ethValue = BigInt(0);

        if (liquidityDetails.pairType === 'native') {
          const wethAddress = await positionManager.WETH9();
          const pairAmount = ethers.parseEther(liquidityDetails.pairAmount);
          
          // Determine token order
          if (tokenAddress.toLowerCase() < wethAddress.toLowerCase()) {
            token0Address = tokenAddress;
            token1Address = wethAddress;
            amount0Desired = tokenAmount;
            amount1Desired = pairAmount;
            ethValue = pairAmount;
          } else {
            token0Address = wethAddress;
            token1Address = tokenAddress;
            amount0Desired = pairAmount;
            amount1Desired = tokenAmount;
            ethValue = pairAmount;
          }
        } else {
          if (!liquidityDetails.pairToken) {
            throw new Error('Pair token not selected');
          }

          const pairTokenContract = new ethers.Contract(
            liquidityDetails.pairToken.address,
            ERC20_ABI,
            signer
          );
          
          const pairAmount = ethers.parseUnits(
            liquidityDetails.pairAmount,
            liquidityDetails.pairToken.decimals
          );

          // Approve pair token
          const pairAllowance = await pairTokenContract.allowance(userAddress, positionManagerAddress);
          if (pairAllowance < pairAmount) {
            const approveTx = await pairTokenContract.approve(positionManagerAddress, pairAmount);
            await approveTx.wait();
          }

          // Determine token order
          if (tokenAddress.toLowerCase() < liquidityDetails.pairToken.address.toLowerCase()) {
            token0Address = tokenAddress;
            token1Address = liquidityDetails.pairToken.address;
            amount0Desired = tokenAmount;
            amount1Desired = pairAmount;
          } else {
            token0Address = liquidityDetails.pairToken.address;
            token1Address = tokenAddress;
            amount0Desired = pairAmount;
            amount1Desired = tokenAmount;
          }
        }

        setTransactionStatus(prev => ({ ...prev, approvals: 'complete' }));

        // Step 2: Check if pool exists and prepare multicall
        setTransactionStatus(prev => ({ ...prev, poolCreation: 'pending' }));
        
        const factory = new ethers.Contract(factoryV3Address, FACTORY_V3_ABI, signer);
        const feeTier = liquidityDetails.feeTier || 3000;
        
        let poolAddress = await factory.getPool(token0Address, token1Address, feeTier);
        
        // Prepare multicall data
        const calldata = [];
        
        if (poolAddress === ethers.ZeroAddress) {
          // Calculate initial price based on token order
          let price: number;
          if (liquidityDetails.pairType === 'native') {
            const tokenAmt = parseFloat(liquidityDetails.tokenAmount);
            const ethAmt = parseFloat(liquidityDetails.pairAmount);
            
            if (tokenAddress.toLowerCase() < (await positionManager.WETH9()).toLowerCase()) {
              price = ethAmt / tokenAmt;
            } else {
              price = tokenAmt / ethAmt;
            }
          } else {
            const tokenAmt = parseFloat(liquidityDetails.tokenAmount);
            const pairAmt = parseFloat(liquidityDetails.pairAmount);
            
            if (tokenAddress.toLowerCase() < liquidityDetails.pairToken!.address.toLowerCase()) {
              price = pairAmt / tokenAmt;
            } else {
              price = tokenAmt / pairAmt;
            }
          }
          
          if (price <= 0 || !isFinite(price)) {
            price = 1;
          }
          
          const sqrtPriceX96 = calculateSqrtPriceX96(price);
          
          // Add createAndInitializePoolIfNecessary to multicall
          const createPoolData = positionManager.interface.encodeFunctionData(
            'createAndInitializePoolIfNecessary',
            [token0Address, token1Address, feeTier, sqrtPriceX96]
          );
          calldata.push(createPoolData);
        }

        // Add mint to multicall
        const { minTick, maxTick } = calculateTicks(feeTier);
        const deadline = Math.floor(Date.now() / 1000) + 1200;
        
        const amount0Min = amount0Desired * BigInt(100 - Math.floor(liquidityDetails.slippage * 100)) / BigInt(100);
        const amount1Min = amount1Desired * BigInt(100 - Math.floor(liquidityDetails.slippage * 100)) / BigInt(100);

        const mintParams = {
          token0: token0Address,
          token1: token1Address,
          fee: feeTier,
          tickLower: minTick,
          tickUpper: maxTick,
          amount0Desired: amount0Desired,
          amount1Desired: amount1Desired,
          amount0Min: amount0Min,
          amount1Min: amount1Min,
          recipient: userAddress,
          deadline: deadline
        };

        const mintData = positionManager.interface.encodeFunctionData('mint', [mintParams]);
        calldata.push(mintData);

        setTransactionStatus(prev => ({ ...prev, poolCreation: 'complete', positionMinting: 'pending' }));

        // Execute multicall
        const tx = await positionManager.multicall(calldata, { value: ethValue });
          const receipt = await tx.wait();
        
        setTransactionStatus(prev => ({ ...prev, positionMinting: 'complete' }));
          setLiquiditySuccess(`Liquidity added successfully! Transaction: ${receipt.hash}`);
        
        // Trigger automated buying after successful V3 liquidity addition
        if (autoBuyEnabled) {
          setTimeout(() => {
            executeAutoBuy(tokenAddress);
          }, 2000); // Wait 2 seconds after liquidity is added
        }
      }

    } catch (error: any) {
      console.error('Liquidity error:', error);
      
      let errorMessage = 'Failed to add liquidity';
      
      if (error.message.includes('insufficient funds')) {
        errorMessage = 'Insufficient funds for transaction';
      } else if (error.message.includes('user rejected')) {
        errorMessage = 'Transaction rejected by user';
      } else if (error.message.includes('Price out of valid range')) {
        errorMessage = 'Price calculation error - please check your amounts';
      } else if (error.message.includes('Invalid price for sqrt calculation')) {
        errorMessage = 'Invalid price calculation - please check your token and pair amounts';
      } else if (error.code === 'CALL_EXCEPTION') {
        if (error.data) {
          errorMessage = `Contract call failed: ${error.reason || 'Unknown reason'}`;
        } else {
          errorMessage = 'Contract call failed - please check token approvals and amounts';
        }
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      setLiquidityError(errorMessage);
      setTransactionStatus({
        approvals: 'idle',
        poolCreation: 'idle',
        positionMinting: 'idle'
      });
    } finally {
      setIsAddingLiquidity(false);
    }
  };

  // Hardcoded RPC URLs by chain ID
  const getRpcUrl = (chainId: number): string => {
    switch (chainId) {
      case 1: return 'https://mainnet.infura.io/v3/013026c83db84ec49fb9ed5c473cede0'; // Ethereum
      case 137: return 'https://polygon-mainnet.infura.io/v3/f28e7f77067d437d838bf32201e1386e'; // Polygon
      case 56: return 'https://bsc-dataseed.binance.org'; // BSC
      case 8453: return 'https://mainnet.base.org'; // Base
      case 42161: return 'https://arb1.arbitrum.io/rpc'; // Arbitrum
      case 10: return 'https://mainnet.optimism.io'; // Optimism
      default: return 'https://polygon-rpc.com'; // Default to Polygon
    }
  };

  // Connect private provider
  const connectPrivateProvider = async () => {
    if (!privateKey) {
      alert('Please enter a private key');
      return;
    }

    try {
      // Create provider with hardcoded RPC URL based on current chain
      const rpcUrl = getRpcUrl(chainId);
      const newProvider = new ethers.JsonRpcProvider(rpcUrl);
      
      // Test connection
      const network = await newProvider.getNetwork();
      
      // Create wallet with private key
      const wallet = new ethers.Wallet(privateKey, newProvider);
      const address = await wallet.getAddress();
      
      // Get balance
      const balance = await newProvider.getBalance(address);
      const formattedBalance = ethers.formatEther(balance);
      
      // Set state
      setPrivateProvider(newProvider);
      setPrivateWallet(wallet);
      setPrivateProviderAddress(address);
      setPrivateProviderBalance(formattedBalance);
      setIsPrivateProviderConnected(true);
      
      return { provider: newProvider, wallet, address };
    } catch (error) {
      console.error('Error connecting private provider:', error);
      alert(`Failed to connect: ${(error as Error).message}`);
      setIsPrivateProviderConnected(false);
      return null;
    }
  };

  // Add liquidity with private key
  const addLiquidityWithPrivateKey = async () => {
    if (!autoLiquidityEnabled) {
      // Use regular addLiquidity function
      addLiquidity();
      return;
    }
    
    if (!isPrivateProviderConnected) {
      const connection = await connectPrivateProvider();
      if (!connection) return;
    }
    
    if (!privateWallet || !privateProvider) {
      alert('Private wallet not connected');
      return;
    }

    // Use either deployed token or manually entered token
    const tokenAddress = liquidityTokenDetails?.address || deploymentResult?.address;
    if (!tokenAddress) {
      alert('Please deploy a contract or enter a token address first');
      return;
    }

    if (!liquidityDetails.tokenAmount || !liquidityDetails.pairAmount) {
      alert('Please enter token and pair amounts');
      return;
    }

    setIsAddingLiquidity(true);
    setLiquidityError('');
    setLiquiditySuccess('');
    setTransactionStatus({
      approvals: 'idle',
      poolCreation: 'idle',
      positionMinting: 'idle'
    });

    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, privateWallet);
      
      // Get token decimals from either source
      const tokenDecimals = liquidityTokenDetails?.decimals || parseInt(contractDetails.decimals);
      const tokenAmount = ethers.parseUnits(liquidityDetails.tokenAmount, tokenDecimals);
      const userAddress = await privateWallet.getAddress();

      if (liquidityDetails.dex === 'uniswap_v2') {
        // Uniswap V2 liquidity
        const routerAddress = getRouterAddress(chainId);
        const router = new ethers.Contract(routerAddress, ROUTER_ABI, privateWallet);

        // Step 1: Approve tokens
        setTransactionStatus(prev => ({ ...prev, approvals: 'pending' }));
        
        const allowance = await tokenContract.allowance(userAddress, routerAddress);
        if (allowance < tokenAmount) {
          const approveTx = await tokenContract.approve(routerAddress, tokenAmount);
          await approveTx.wait();
        }
        
        setTransactionStatus(prev => ({ ...prev, approvals: 'complete' }));

        // Step 2: Add liquidity
        if (liquidityDetails.pairType === 'native') {
          const nativeAmount = ethers.parseEther(liquidityDetails.pairAmount);
          const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 minutes

          // Make tokenAmount mutable
          let tokenAmount = ethers.parseUnits(liquidityDetails.tokenAmount, tokenDecimals);
          let minTokenAmount = tokenAmount * BigInt(100 - Math.floor(liquidityDetails.slippage * 100)) / BigInt(100);
          let minNativeAmount = nativeAmount * BigInt(100 - Math.floor(liquidityDetails.slippage * 100)) / BigInt(100);

          // Check if wallet has enough balance
          const balance = await privateProvider.getBalance(userAddress);
          console.log(`Native balance: ${ethers.formatEther(balance)} ${getNetworkSymbol(chainId)}`);
          
          if (balance < nativeAmount) {
            throw new Error(`Insufficient balance. Required: ${liquidityDetails.pairAmount} ${getNetworkSymbol(chainId)}, Available: ${ethers.formatEther(balance)} ${getNetworkSymbol(chainId)}`);
          }

          console.log('ANTI-SNIPER MODE: Adding liquidity with ultra-high gas');
          
          try {
            // Check if the router contract is valid by checking if it has the addLiquidityETH method
            if (!router.addLiquidityETH) {
              throw new Error('Invalid router contract - addLiquidityETH method not found');
            }
            
            // Check if pair already exists by trying to get the pair directly from known factory addresses
            let pairExists = false;
            let token0 = '';
            let token1 = '';
            let reserve0 = BigInt(0);
            let reserve1 = BigInt(0);
            
            try {
              // Common factory addresses for different chains
              let factoryAddress = '';
              if (chainId === 1) { // Ethereum Mainnet
                factoryAddress = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'; // Uniswap V2 Factory
              } else if (chainId === 137) { // Polygon
                factoryAddress = '0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32'; // QuickSwap Factory
              } else if (chainId === 56) { // BSC
                factoryAddress = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73'; // PancakeSwap Factory
              }
              
              if (factoryAddress) {
                // Get the factory contract
                const factoryAbi = [
                  "function getPair(address tokenA, address tokenB) external view returns (address pair)"
                ];
                const factory = new ethers.Contract(factoryAddress, factoryAbi, privateProvider || provider);
                
                // Get WETH/WMATIC/BNB address based on chain
                let wethAddress = '';
                if (chainId === 1) {
                  wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // WETH on Ethereum
                } else if (chainId === 137) {
                  wethAddress = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'; // WMATIC on Polygon
                } else if (chainId === 56) {
                  wethAddress = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'; // WBNB on BSC
                }
                
                if (wethAddress) {
                  // Get the pair address
                  const pairAddress = await factory.getPair(tokenAddress, wethAddress).catch(() => null);
                  
                  if (pairAddress && pairAddress !== ethers.ZeroAddress) {
                    console.log(`Pair already exists at ${pairAddress}`);
                    pairExists = true;
                    
                    // Get the pair contract to check reserves
                    const pairAbi = [
                      "function token0() external view returns (address)",
                      "function token1() external view returns (address)",
                      "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"
                    ];
                    const pairContract = new ethers.Contract(pairAddress, pairAbi, privateProvider || provider);
                    
                    // Get tokens in the pair
                    token0 = await pairContract.token0();
                    token1 = await pairContract.token1();
                    
                    // Get reserves
                    const reserves = await pairContract.getReserves();
                    reserve0 = reserves[0];
                    reserve1 = reserves[1];
                    
                    console.log(`Pair reserves: ${ethers.formatUnits(reserve0)} (token0: ${token0}), ${ethers.formatUnits(reserve1)} (token1: ${token1})`);
                    
                    // Determine which token is which in the pair
                    const tokenIsToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();
                    const tokenReserve = tokenIsToken0 ? reserve0 : reserve1;
                    const ethReserve = tokenIsToken0 ? reserve1 : reserve0;
                    
                    console.log(`Token reserve: ${ethers.formatUnits(tokenReserve, tokenDecimals)}, ETH reserve: ${ethers.formatEther(ethReserve)}`);
                    
                    // Calculate the price ratio
                    if (ethReserve > 0 && tokenReserve > 0) {
                      // If adding to existing pair, we need to match the current price ratio
                      // Calculate the expected token amount based on the ETH amount and current ratio
                      const currentRatio = Number(tokenReserve) / Number(ethReserve);
                      const expectedTokenAmount = BigInt(Math.floor(Number(nativeAmount) * currentRatio));
                      
                      console.log(`Current price ratio: ${currentRatio} tokens per ETH`);
                      console.log(`You're providing: ${ethers.formatEther(nativeAmount)} ETH and ${ethers.formatUnits(tokenAmount, tokenDecimals)} tokens`);
                      console.log(`Expected token amount for this ETH: ${ethers.formatUnits(expectedTokenAmount, tokenDecimals)}`);
                      
                      // Check if the provided token amount is close enough to the expected amount
                      const tolerance = 0.05; // 5% tolerance
                      const minExpected = expectedTokenAmount * BigInt(Math.floor((1 - tolerance) * 100)) / BigInt(100);
                      const maxExpected = expectedTokenAmount * BigInt(Math.floor((1 + tolerance) * 100)) / BigInt(100);
                      
                      if (tokenAmount < minExpected || tokenAmount > maxExpected) {
                        console.log(`WARNING: Your token amount is not matching the current price ratio.`);
                        console.log(`Recommended token amount: ${ethers.formatUnits(expectedTokenAmount, tokenDecimals)}`);
                        
                        // Ask user if they want to adjust the token amount
                        const adjustAmount = confirm(
                          `Your token amount doesn't match the current price ratio in the pool.\n\n` +
                          `Current ratio: ${currentRatio} tokens per ETH\n` +
                          `You're providing: ${ethers.formatUnits(tokenAmount, tokenDecimals)} tokens for ${ethers.formatEther(nativeAmount)} ETH\n` +
                          `Recommended: ${ethers.formatUnits(expectedTokenAmount, tokenDecimals)} tokens\n\n` +
                          `Would you like to adjust your token amount to match the current price ratio?`
                        );
                        
                        if (adjustAmount) {
                          // Adjust the token amount to match the current price ratio
                          tokenAmount = expectedTokenAmount;
                          console.log(`Adjusted token amount to: ${ethers.formatUnits(tokenAmount, tokenDecimals)}`);
                        } else {
                          throw new Error(
                            `Cannot add liquidity with the provided amounts. Please adjust your token amount to approximately ` +
                            `${ethers.formatUnits(expectedTokenAmount, tokenDecimals)} to match the current price ratio.`
                          );
                        }
                      }
                    }
                  }
                }
              }
            } catch (pairCheckError) {
              console.error('Error checking for existing pair:', pairCheckError);
              // Continue with liquidity addition even if pair check fails
            }
            
            // Recalculate min amounts after potential adjustment
            minTokenAmount = tokenAmount * BigInt(100 - Math.floor(liquidityDetails.slippage * 100)) / BigInt(100);
            minNativeAmount = nativeAmount * BigInt(100 - Math.floor(liquidityDetails.slippage * 100)) / BigInt(100);
            
            // Try estimating gas first to catch errors
            const gasEstimate = await router.addLiquidityETH.estimateGas(
              tokenAddress,
              tokenAmount,
              minTokenAmount,
              minNativeAmount,
              userAddress,
              deadline,
              { value: nativeAmount }
            ).catch((e: any) => {
              console.error('Gas estimation failed:', e);
              // Check if the error message contains information about the reversion
              const errorMessage = e.message || '';
              if (errorMessage.includes('INSUFFICIENT_A_AMOUNT')) {
                throw new Error(
                  'Gas estimation failed: INSUFFICIENT_A_AMOUNT. This usually means your token amount is too low ' +
                  'compared to the ETH amount for the current price ratio in the pool.'
                );
              } else if (errorMessage.includes('INSUFFICIENT_B_AMOUNT')) {
                throw new Error(
                  'Gas estimation failed: INSUFFICIENT_B_AMOUNT. This usually means your ETH amount is too low ' +
                  'compared to the token amount for the current price ratio in the pool.'
                );
              } else if (errorMessage.includes('insufficient')) {
                throw new Error('Gas estimation failed: Insufficient funds');
              } else if (errorMessage.includes('transfer amount exceeds balance')) {
                throw new Error('Gas estimation failed: Transfer amount exceeds balance');
              } else {
                throw new Error(`Gas estimation failed: ${errorMessage}`);
              }
            });
            
            console.log(`Gas estimate for liquidity: ${gasEstimate}`);

            // Send liquidity transaction with ultra-high gas price
            const liquidityTx = await router.addLiquidityETH(
              tokenAddress,
              tokenAmount,
              minTokenAmount,
              minNativeAmount,
              userAddress,
              deadline,
              { 
                value: nativeAmount,
                gasLimit: BigInt(gasEstimate.toString()) * BigInt(12) / BigInt(10), // Add 20% buffer
                maxFeePerGas: MAX_FEE,
                maxPriorityFeePerGas: PRIORITY_GAS
              }
            );
            
            console.log('ANTI-SNIPER MODE: Liquidity transaction sent:', liquidityTx.hash);
            liquidityTxHash = liquidityTx.hash;
            
            // ANTI-SNIPER TECHNIQUE: Send buy transactions IMMEDIATELY after liquidity tx is sent
            // Don't wait for liquidity to be confirmed - this reduces the gap between transactions
            if (buyerWallets.length > 0) {
              console.log('ANTI-SNIPER MODE: Executing buy transactions IMMEDIATELY');
              
              // Execute all buy transactions in parallel without waiting for liquidity confirmation
              const buyPromises = buyerWallets.map(async ({ wallet, tx }, i) => {
                try {
                  console.log(`ANTI-SNIPER MODE: Sending buy transaction ${i} immediately`);
                  const sentTx = await wallet.sendTransaction(tx);
                  console.log(`Buy transaction ${i} sent:`, sentTx.hash);
                  return sentTx.hash;
                } catch (error) {
                  console.error(`Error sending buy transaction ${i}:`, error);
                  return null;
                }
              });
              
              // Collect buy transaction hashes
              const buyHashes = await Promise.all(buyPromises);
              const validBuyHashes = buyHashes.filter(hash => hash !== null) as string[];
              
              console.log('ANTI-SNIPER MODE: All buy transactions sent:', validBuyHashes);
              
              // Now wait for liquidity transaction to be mined
              console.log('Now waiting for liquidity transaction confirmation...');
              const receipt = await liquidityTx.wait();
              console.log('Liquidity confirmed, status:', receipt.status, 'block:', receipt.blockNumber);
              
              if (receipt.status === 0) {
                throw new Error('Liquidity transaction failed on-chain');
              }
              
              txHashes.push(liquidityTx.hash);
              
              // Wait for buy transactions to be mined and collect results
              const buyResults = await Promise.all(
                validBuyHashes.map(async (hash, i) => {
                  try {
                    const receipt = await provider!.getTransactionReceipt(hash);
                    const blockDiff = receipt ? receipt.blockNumber - (receipt.blockNumber || 0) : 'unknown';
                    console.log(`Buy transaction ${i} confirmed in block: ${receipt?.blockNumber}, ` +
                                `block difference: ${blockDiff}`);
                    return {
                      success: receipt?.status === 1,
                      hash,
                      blockNumber: receipt?.blockNumber
                    };
                  } catch (error) {
                    console.error(`Error getting receipt for buy transaction ${i}:`, error);
                    return { success: false, hash, error: (error as Error).message };
                  }
                })
              );
              
              console.log('All buy transactions completed:', buyResults);
              
              // Update the UI with buy transaction hashes
              setBundleResults({
                liquidityTxHash,
                buyTxHashes: validBuyHashes,
              });
            } else {
              // If no buy transactions, just wait for liquidity to be mined
              const receipt = await liquidityTx.wait();
              console.log('Liquidity confirmed, status:', receipt.status);
              
              if (receipt.status === 0) {
                throw new Error('Liquidity transaction failed on-chain');
              }
              
              txHashes.push(liquidityTx.hash);
              
              setBundleResults({
                liquidityTxHash,
                buyTxHashes: [],
              });
            }
            
            setLiquiditySuccess(`All transactions completed successfully!`);
          } catch (liquidityError) {
            console.error('Liquidity transaction failed:', liquidityError);
            
            // Try to get more information about the error
            let errorMessage = `Liquidity addition failed: ${(liquidityError as Error).message}`;
            
            // Check for common errors
            const errorString = (liquidityError as Error).message.toLowerCase();
            if (errorString.includes('transfer amount exceeds balance')) {
              errorMessage = 'Token transfer failed: amount exceeds balance';
            } else if (errorString.includes('insufficient')) {
              errorMessage = 'Insufficient funds for transaction';
            } else if (errorString.includes('pair exists')) {
              errorMessage = 'Pair already exists - try using a different token or pair';
            } else if (errorString.includes('k')) {
              errorMessage = 'Liquidity addition failed: K value error (imbalanced reserves)';
            } else if (errorString.includes('expired')) {
              errorMessage = 'Transaction deadline expired';
            } else if (errorString.includes('slippage')) {
              errorMessage = 'Price changed - try increasing slippage tolerance';
            }
            
            throw new Error(errorMessage);
          }
        } else {
          // Token-to-token liquidity (similar implementation)
          // ...
        }
      } else if (liquidityDetails.dex === 'uniswap_v3') {
        // Uniswap V3 liquidity with multicall
        const positionManagerAddress = getPositionManagerAddress(chainId);
        const factoryV3Address = getFactoryV3Address(chainId);
        
        const positionManager = new ethers.Contract(
          positionManagerAddress,
          POSITION_MANAGER_ABI,
          privateWallet
        );

        // Step 1: Approve tokens
        setTransactionStatus(prev => ({ ...prev, approvals: 'pending' }));
        
        const allowance = await tokenContract.allowance(userAddress, positionManagerAddress);
        if (allowance < tokenAmount) {
          const approveTx = await tokenContract.approve(positionManagerAddress, tokenAmount);
          await approveTx.wait();
        }

        let token0Address: string;
        let token1Address: string;
        let amount0Desired: bigint;
        let amount1Desired: bigint;
        let ethValue = BigInt(0);

        if (liquidityDetails.pairType === 'native') {
          const wethAddress = await positionManager.WETH9();
          const pairAmount = ethers.parseEther(liquidityDetails.pairAmount);
          
          // Check if wallet has enough balance
          const balance = await privateProvider.getBalance(userAddress);
          if (balance < pairAmount) {
            throw new Error(`Insufficient balance. Required: ${liquidityDetails.pairAmount} ${getNetworkSymbol(chainId)}, Available: ${ethers.formatEther(balance)} ${getNetworkSymbol(chainId)}`);
          }
          
          // Determine token order
          if (tokenAddress.toLowerCase() < wethAddress.toLowerCase()) {
            token0Address = tokenAddress;
            token1Address = wethAddress;
            amount0Desired = tokenAmount;
            amount1Desired = pairAmount;
            ethValue = pairAmount;
          } else {
            token0Address = wethAddress;
            token1Address = tokenAddress;
            amount0Desired = pairAmount;
            amount1Desired = tokenAmount;
            ethValue = pairAmount;
          }
        } else {
          if (!liquidityDetails.pairToken) {
            throw new Error('Pair token not selected');
          }

          const pairTokenContract = new ethers.Contract(
            liquidityDetails.pairToken.address,
            ERC20_ABI,
            privateWallet
          );
          
          const pairAmount = ethers.parseUnits(
            liquidityDetails.pairAmount,
            liquidityDetails.pairToken.decimals
          );

          // Approve pair token
          const pairAllowance = await pairTokenContract.allowance(userAddress, positionManagerAddress);
          if (pairAllowance < pairAmount) {
            const approveTx = await pairTokenContract.approve(positionManagerAddress, pairAmount);
            await approveTx.wait();
          }

          // Determine token order
          if (tokenAddress.toLowerCase() < liquidityDetails.pairToken.address.toLowerCase()) {
            token0Address = tokenAddress;
            token1Address = liquidityDetails.pairToken.address;
            amount0Desired = tokenAmount;
            amount1Desired = pairAmount;
          } else {
            token0Address = liquidityDetails.pairToken.address;
            token1Address = tokenAddress;
            amount0Desired = pairAmount;
            amount1Desired = tokenAmount;
          }
        }

        setTransactionStatus(prev => ({ ...prev, approvals: 'complete' }));

        // Step 2: Check if pool exists and prepare multicall
        setTransactionStatus(prev => ({ ...prev, poolCreation: 'pending' }));
        
        const factory = new ethers.Contract(factoryV3Address, FACTORY_V3_ABI, privateWallet);
        const feeTier = liquidityDetails.feeTier || 3000;
        
        let poolAddress = await factory.getPool(token0Address, token1Address, feeTier);
        
        // Prepare multicall data
        const calldata = [];
        
        if (poolAddress === ethers.ZeroAddress) {
          // Calculate initial price based on token order
          let price: number;
          if (liquidityDetails.pairType === 'native') {
            const tokenAmt = parseFloat(liquidityDetails.tokenAmount);
            const ethAmt = parseFloat(liquidityDetails.pairAmount);
            
            if (tokenAddress.toLowerCase() < (await positionManager.WETH9()).toLowerCase()) {
              price = ethAmt / tokenAmt;
            } else {
              price = tokenAmt / ethAmt;
            }
          } else {
            const tokenAmt = parseFloat(liquidityDetails.tokenAmount);
            const pairAmt = parseFloat(liquidityDetails.pairAmount);
            
            if (tokenAddress.toLowerCase() < liquidityDetails.pairToken!.address.toLowerCase()) {
              price = pairAmt / tokenAmt;
            } else {
              price = tokenAmt / pairAmt;
            }
          }
          
          if (price <= 0 || !isFinite(price)) {
            price = 1;
          }
          
          const sqrtPriceX96 = calculateSqrtPriceX96(price);
          
          // Add createAndInitializePoolIfNecessary to multicall
          const createPoolData = positionManager.interface.encodeFunctionData(
            'createAndInitializePoolIfNecessary',
            [token0Address, token1Address, feeTier, sqrtPriceX96]
          );
          calldata.push(createPoolData);
        }

        // Add mint to multicall
        const { minTick, maxTick } = calculateTicks(feeTier);
        const deadline = Math.floor(Date.now() / 1000) + 1200;
        
        const amount0Min = amount0Desired * BigInt(100 - Math.floor(liquidityDetails.slippage * 100)) / BigInt(100);
        const amount1Min = amount1Desired * BigInt(100 - Math.floor(liquidityDetails.slippage * 100)) / BigInt(100);

        const mintParams = {
          token0: token0Address,
          token1: token1Address,
          fee: feeTier,
          tickLower: minTick,
          tickUpper: maxTick,
          amount0Desired: amount0Desired,
          amount1Desired: amount1Desired,
          amount0Min: amount0Min,
          amount1Min: amount1Min,
          recipient: userAddress,
          deadline: deadline
        };

        const mintData = positionManager.interface.encodeFunctionData('mint', [mintParams]);
        calldata.push(mintData);

        setTransactionStatus(prev => ({ ...prev, poolCreation: 'complete', positionMinting: 'pending' }));

        // Execute multicall
        const tx = await positionManager.multicall(calldata, { value: ethValue });
        const receipt = await tx.wait();
        
        setTransactionStatus(prev => ({ ...prev, positionMinting: 'complete' }));
        setLiquiditySuccess(`Liquidity added successfully! Transaction: ${receipt.hash}`);
        
        // Trigger automated buying after successful V3 liquidity addition
        if (autoBuyEnabled) {
          setTimeout(() => {
            executeAutoBuy(tokenAddress);
          }, 2000); // Wait 2 seconds after liquidity is added
        }
      }

    } catch (error: any) {
      console.error('Liquidity error:', error);
      
      let errorMessage = 'Failed to add liquidity';
      
      if (error.message.includes('insufficient funds')) {
        errorMessage = 'Insufficient funds for transaction';
      } else if (error.message.includes('user rejected')) {
        errorMessage = 'Transaction rejected by user';
      } else if (error.message.includes('Price out of valid range')) {
        errorMessage = 'Price calculation error - please check your amounts';
      } else if (error.message.includes('Invalid price for sqrt calculation')) {
        errorMessage = 'Invalid price calculation - please check your token and pair amounts';
      } else if (error.code === 'CALL_EXCEPTION') {
        if (error.data) {
          errorMessage = `Contract call failed: ${error.reason || 'Unknown reason'}`;
        } else {
          errorMessage = 'Contract call failed - please check token approvals and amounts';
        }
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      setLiquidityError(errorMessage);
      setTransactionStatus({
        approvals: 'idle',
        poolCreation: 'idle',
        positionMinting: 'idle'
      });
    } finally {
      setIsAddingLiquidity(false);
    }
  };

  const renderTransactionStatus = () => {
    if (!isAddingLiquidity) return null;

    return (
      <div className="bg-black/20 backdrop-blur-xl rounded-2xl border border-white/10 p-4">
        <h4 className="text-lg font-bold text-white mb-4 font-space-grotesk">Transaction Progress</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-black/30 rounded-lg p-3 border border-white/10">
            <span className="text-white/60 text-sm font-open-sans">Token Approvals:</span>
            <span className={`text-white font-semibold ${
              transactionStatus.approvals === 'complete' ? 'text-green-400' : 
              transactionStatus.approvals === 'pending' ? 'text-yellow-400' : 'text-white/60'
            }`}>
              {transactionStatus.approvals === 'complete' ? '✓ Complete' : 
               transactionStatus.approvals === 'pending' ? '⏳ Pending' : 
               transactionStatus.approvals === 'skipped' ? '⏭ Skipped' : '⏸ Idle'}
            </span>
          </div>
          
          {liquidityDetails.dex === 'uniswap_v3' && (
            <>
              <div className="bg-black/30 rounded-lg p-3 border border-white/10">
                <span className="text-white/60 text-sm font-open-sans">Pool Creation:</span>
                <span className={`text-white font-semibold ${
                  transactionStatus.poolCreation === 'complete' ? 'text-green-400' : 
                  transactionStatus.poolCreation === 'pending' ? 'text-yellow-400' : 'text-white/60'
                }`}>
                  {transactionStatus.poolCreation === 'complete' ? '✓ Complete' : 
                   transactionStatus.poolCreation === 'pending' ? '⏳ Pending' : 
                   transactionStatus.poolCreation === 'skipped' ? '⏭ Skipped' : '⏸ Idle'}
                </span>
              </div>
              
              <div className="bg-black/30 rounded-lg p-3 border border-white/10">
                <span className="text-white/60 text-sm font-open-sans">Position Minting:</span>
                <span className={`text-white font-semibold ${
                  transactionStatus.positionMinting === 'complete' ? 'text-green-400' : 
                  transactionStatus.positionMinting === 'pending' ? 'text-yellow-400' : 'text-white/60'
                }`}>
                  {transactionStatus.positionMinting === 'complete' ? '✓ Complete' : 
                   transactionStatus.positionMinting === 'pending' ? '⏳ Pending' : '⏸ Idle'}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  // Price calculation effect
  useEffect(() => {
    if (!provider || !liquidityDetails.tokenAmount || !liquidityDetails.pairAmount) return;

    const updatePrices = async () => {
      // Get total supply from either source
      const totalSupply = liquidityTokenDetails?.totalSupply || contractDetails.totalSupply;
      
      const priceRatio = await calculatePriceRatios(
        provider,
        liquidityDetails.tokenAmount,
        liquidityDetails.pairAmount,
        totalSupply,
        chainId,
        liquidityDetails.pairType,
        liquidityDetails.pairToken
      );

      const percentageOfSupply = totalSupply ? 
        (parseFloat(liquidityDetails.tokenAmount) / parseFloat(totalSupply)) * 100 : 0;

      setLiquidityDetails(prev => ({
        ...prev,
        priceRatio,
        percentageOfSupply
      }));
    };

    const debounceTimer = setTimeout(updatePrices, 500);
    return () => clearTimeout(debounceTimer);
  }, [
    provider,
    liquidityDetails.tokenAmount,
    liquidityDetails.pairAmount,
    liquidityDetails.pairToken,
    liquidityDetails.pairType,
    contractDetails.totalSupply,
    liquidityTokenDetails?.totalSupply,
    chainId
  ]);

  // Dropdown click outside handler
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowTokenDropdown(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="space-y-6">
      {/* Token Address Input Section */}
      <div className="bg-black/20 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
        <h3 className="text-xl font-bold text-white mb-6 font-space-grotesk">Select Token</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-white/80 text-sm font-medium mb-2 font-open-sans">Token Address</label>
            <input
              type="text"
              className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-all duration-200"
              value={liquidityTokenAddress}
              onChange={(e) => setLiquidityTokenAddress(e.target.value)}
              placeholder="Enter token contract address (leave empty to use deployed token)"
            />
          </div>
          <div className="flex flex-wrap gap-4">
            <button 
              className="px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-semibold rounded-xl transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={fetchLiquidityTokenDetails} 
              disabled={isLoadingLiquidityToken}
            >
              {isLoadingLiquidityToken ? 'Loading...' : 'Load Token Details'}
            </button>
            {deploymentResult && (
              <button 
                className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl transition-all duration-200 border border-white/20"
                onClick={() => {
                  setLiquidityTokenAddress('');
                  setLiquidityTokenDetails(null);
                }}
              >
                Use Deployed Token
              </button>
            )}
          </div>
        </div>

        {/* Token Details Display */}
        {liquidityTokenDetails && (
          <div className="mt-6 bg-black/30 rounded-xl p-4 border border-white/10">
            <h4 className="text-lg font-bold text-white mb-4 font-space-grotesk">Token Details</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-black/40 rounded-lg p-3 border border-white/10">
                <span className="text-white/60 text-sm font-open-sans">Name:</span>
                <div className="text-white font-semibold mt-1">{liquidityTokenDetails.name}</div>
              </div>
              <div className="bg-black/40 rounded-lg p-3 border border-white/10">
                <span className="text-white/60 text-sm font-open-sans">Symbol:</span>
                <div className="text-white font-semibold mt-1">{liquidityTokenDetails.symbol}</div>
              </div>
              <div className="bg-black/40 rounded-lg p-3 border border-white/10">
                <span className="text-white/60 text-sm font-open-sans">Decimals:</span>
                <div className="text-white font-semibold mt-1">{liquidityTokenDetails.decimals}</div>
              </div>
              <div className="bg-black/40 rounded-lg p-3 border border-white/10">
                <span className="text-white/60 text-sm font-open-sans">Total Supply:</span>
                <div className="text-white font-semibold mt-1">{formatNumber(liquidityTokenDetails.totalSupply)}</div>
              </div>
              <div className="bg-black/40 rounded-lg p-3 border border-white/10">
                <span className="text-white/60 text-sm font-open-sans">Your Balance:</span>
                <div className="text-white font-semibold mt-1">{formatNumber(liquidityTokenDetails.balance || '0')}</div>
              </div>
              <div className="bg-black/40 rounded-lg p-3 border border-white/10">
                <span className="text-white/60 text-sm font-open-sans">Address:</span>
                <div className="text-purple-300 font-mono text-sm break-all mt-1">{liquidityTokenDetails.address}</div>
              </div>
            </div>
          </div>
        )}

        {/* Show deployed token info if no manual token selected */}
        {!liquidityTokenDetails && deploymentResult && (
          <div className="mt-6 bg-black/30 rounded-xl p-4 border border-white/10">
            <h4 className="text-lg font-bold text-white mb-4 font-space-grotesk">Using Deployed Token</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-black/40 rounded-lg p-3 border border-white/10">
                <span className="text-white/60 text-sm font-open-sans">Name:</span>
                <div className="text-white font-semibold mt-1">{contractDetails.name}</div>
              </div>
              <div className="bg-black/40 rounded-lg p-3 border border-white/10">
                <span className="text-white/60 text-sm font-open-sans">Symbol:</span>
                <div className="text-white font-semibold mt-1">{contractDetails.symbol}</div>
              </div>
              <div className="bg-black/40 rounded-lg p-3 border border-white/10">
                <span className="text-white/60 text-sm font-open-sans">Address:</span>
                <div className="text-purple-300 font-mono text-sm break-all mt-1">{deploymentResult.address}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Show liquidity form only if we have a token */}
      {(liquidityTokenDetails || deploymentResult) ? (
        <div className="space-y-6">
          {/* Automated Liquidity Section */}
          <div className="bg-black/20 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
            <h3 className="text-xl font-bold text-white mb-6 font-space-grotesk">Automated Liquidity</h3>
            <div className="flex items-center justify-between mb-4">
              <label htmlFor="autoLiquidityToggle" className="text-white/80 font-open-sans">Enable Automated Liquidity (Private Key)</label>
              <input
                type="checkbox"
                id="autoLiquidityToggle"
                className="w-5 h-5 text-purple-500 bg-black/50 border-white/20 rounded focus:ring-purple-500 focus:ring-2"
                checked={autoLiquidityEnabled}
                onChange={(e) => setAutoLiquidityEnabled(e.target.checked)}
              />
            </div>

            {autoLiquidityEnabled && (
              <div className="space-y-4 mt-6">
                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-white/80 text-sm font-medium mb-2 font-open-sans">Private Key</label>
                    <input
                      type="password"
                      className="w-full px-4 py-3 bg-black/40 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-all duration-200"
                      value={privateKey}
                      onChange={(e) => setPrivateKey(e.target.value)}
                      placeholder="Enter your private key"
                    />
                    <p className="text-white/60 text-xs mt-1">Using RPC: {getRpcUrl(chainId)}</p>
                  </div>
                </div>
                <button 
                  className="px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-semibold rounded-xl transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-purple-500/25"
                  onClick={connectPrivateProvider}
                >
                  Connect Private Provider
                </button>
                
                {isPrivateProviderConnected && (
                  <div className="bg-black/30 rounded-xl p-4 border border-green-500/30">
                    <h4 className="text-lg font-bold text-white mb-2 font-space-grotesk">Connected Wallet</h4>
                    <div className="space-y-2">
                      <div className="text-white/80 text-sm">
                        <span className="text-white/60">Address:</span> {privateProviderAddress.slice(0, 8)}...{privateProviderAddress.slice(-6)}
                      </div>
                      <div className="text-white/80 text-sm">
                        <span className="text-white/60">Balance:</span> {privateProviderBalance} {getNetworkSymbol(chainId)}
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Bundle Transactions Option */}
                {isPrivateProviderConnected && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between mb-2">
                      <label htmlFor="bundleToggle" className="text-white/80 font-open-sans">
                        Bundle Liquidity + Auto-Buy (Fast Sequence)
                      </label>
                      <input
                        type="checkbox"
                        id="bundleToggle"
                        className="w-5 h-5 text-purple-500 bg-black/50 border-white/20 rounded focus:ring-purple-500 focus:ring-2"
                        checked={bundleTransactions}
                        onChange={(e) => setBundleTransactions(e.target.checked)}
                      />
                    </div>
                    <p className="text-white/60 text-xs">
                      Executes liquidity addition and buys in rapid succession with high gas fees to minimize front-running
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-black/20 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
            <h3 className="text-xl font-bold text-white mb-6 font-space-grotesk">Liquidity Configuration</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-white/80 text-sm font-medium mb-2 font-open-sans">Token Amount</label>
                <input
                  type="number"
                  className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-all duration-200"
                  value={liquidityDetails.tokenAmount}
                  onChange={(e) => setLiquidityDetails(prev => ({ ...prev, tokenAmount: e.target.value }))}
                  placeholder="Enter token amount"
                />
              </div>
              <div>
                <label className="block text-white/80 text-sm font-medium mb-2 font-open-sans">
                  Pair Amount ({liquidityDetails.pairType === 'native' ? getNetworkSymbol(chainId) : liquidityDetails.pairToken?.symbol || 'Token'})
                </label>
                <input
                  type="number"
                  className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-all duration-200"
                  value={liquidityDetails.pairAmount}
                  onChange={(e) => setLiquidityDetails(prev => ({ ...prev, pairAmount: e.target.value }))}
                  placeholder="Enter pair amount"
                />
              </div>
              <div>
                <label className="block text-white/80 text-sm font-medium mb-2 font-open-sans">Slippage (%)</label>
                <input
                  type="number"
                  min="0"
                  max="50"
                  step="0.1"
                  className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-all duration-200"
                  value={liquidityDetails.slippage}
                  onChange={(e) => setLiquidityDetails(prev => ({ ...prev, slippage: parseFloat(e.target.value) }))}
                  placeholder="0.5"
                />
              </div>
              <div>
                <label className="block text-white/80 text-sm font-medium mb-2 font-open-sans">Pair Type</label>
                <select
                  className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white focus:outline-none focus:border-purple-500 transition-all duration-200"
                  value={liquidityDetails.pairType}
                  onChange={(e) => setLiquidityDetails(prev => ({ ...prev, pairType: e.target.value as 'native' | 'token' }))}
                >
                  <option value="native">Native ({getNetworkSymbol(chainId)})</option>
                  <option value="token">Token</option>
                </select>
              </div>
            </div>

            {/* Token Pair Selection - only show when pair type is 'token' */}
            {liquidityDetails.pairType === 'token' && (
              <div className="mt-6">
                <label className="block text-white/80 text-sm font-medium mb-2 font-open-sans">Select Pair Token</label>
                <div className="relative" ref={dropdownRef}>
                  <button
                    type="button"
                    className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white/80 hover:text-white hover:border-purple-500 transition-all duration-200 flex items-center justify-between"
                    onClick={() => setShowTokenDropdown(!showTokenDropdown)}
                  >
                    {liquidityDetails.pairToken ? 
                      `${liquidityDetails.pairToken.symbol} - ${liquidityDetails.pairToken.name}` : 
                      'Select a token pair'
                    }
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/60 ml-2">
                      <path d="M6 9l6 6 6-6"/>
                    </svg>
                  </button>
                  
                  {showTokenDropdown && (
                    <div className="absolute z-10 w-full mt-1 bg-black/50 backdrop-blur-lg border border-white/10 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                      {TOKEN_PAIRS[chainId]?.map((token) => (
                        <div
                          key={token.address}
                          className="px-4 py-3 text-white/80 hover:bg-white/5 hover:text-white cursor-pointer transition-colors duration-150"
                          onClick={() => {
                            setLiquidityDetails(prev => ({ ...prev, pairToken: token }));
                            setShowTokenDropdown(false);
                          }}
                        >
                          <div className="font-semibold">{token.symbol}</div>
                          <div className="text-sm text-white/60">{token.name}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
              <div>
                <label className="block text-white/80 text-sm font-medium mb-2 font-open-sans">DEX</label>
                <select
                  className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white focus:outline-none focus:border-purple-500 transition-all duration-200"
                  value={liquidityDetails.dex}
                  onChange={(e) => setLiquidityDetails(prev => ({ ...prev, dex: e.target.value as any }))}
                >
                  {getAvailableDEXs(chainId).map(dex => (
                    <option key={dex} value={dex}>
                      {dex === 'uniswap_v2' ? 'Uniswap V2' : 
                       dex === 'uniswap_v3' ? 'Uniswap V3' : dex}
                    </option>
                  ))}
                </select>
              </div>
              {liquidityDetails.dex === 'uniswap_v3' && (
                <div>
                  <label className="block text-white/80 text-sm font-medium mb-2 font-open-sans">Fee Tier (Uniswap V3)</label>
                  <select
                    className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white focus:outline-none focus:border-purple-500 transition-all duration-200"
                    value={liquidityDetails.feeTier}
                    onChange={(e) => setLiquidityDetails(prev => ({ ...prev, feeTier: parseInt(e.target.value) as 100 | 500 | 3000 | 10000 }))}
                  >
                    {V3_FEE_TIERS.map(tier => (
                      <option key={tier} value={tier}>
                        {tier / 10000}% ({tier} BPS)
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Price Ratios */}
            <div className="mt-6 bg-black/30 rounded-xl p-4 border border-white/10">
              <h4 className="text-lg font-bold text-white mb-4 font-space-grotesk">Price Ratios</h4>
              <div className="space-y-3">
                <div>
                  <span className="text-white/60 text-sm font-open-sans">1 {liquidityTokenDetails?.symbol || contractDetails.symbol} = </span>
                  <span className="text-white font-semibold">{liquidityDetails.priceRatio.pairPerToken} {liquidityDetails.pairType === 'native' ? getNetworkSymbol(chainId) : liquidityDetails.pairToken?.symbol || 'Token'}</span>
                </div>
                <div>
                  <span className="text-white/60 text-sm font-open-sans">1 {liquidityDetails.pairType === 'native' ? getNetworkSymbol(chainId) : liquidityDetails.pairToken?.symbol || 'Token'} = </span>
                  <span className="text-white font-semibold">{liquidityDetails.priceRatio.tokenPerPair} {liquidityTokenDetails?.symbol || contractDetails.symbol}</span>
                </div>
                <div>
                  <span className="text-white/60 text-sm font-open-sans">USD Value (Approx):</span>
                  <span className="text-white font-semibold">${liquidityDetails.priceRatio.usdValue}</span>
                </div>
              </div>
            </div>

            {/* Action Button */}
            <div className="mt-6">
              <button 
                className="w-full px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-semibold rounded-xl transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={autoLiquidityEnabled && bundleTransactions ? executeLocalBundle : autoLiquidityEnabled ? addLiquidityWithPrivateKey : addLiquidity}
                disabled={isAddingLiquidity || isBundling}
              >
                {isBundling ? 'Executing Bundled Transactions...' : 
                 isAddingLiquidity ? 'Adding Liquidity...' : 
                 bundleTransactions ? 'Add Liquidity + Auto-Buy (Fast Sequence)' : 'Add Liquidity'}
              </button>
            </div>

            {/* Bundle Results */}
            {bundleResults && (
              <div className="mt-6 bg-black/30 rounded-xl p-4 border border-white/10">
                <h4 className="text-lg font-bold text-white mb-4 font-space-grotesk">Transaction Results</h4>
                
                {bundleResults.error ? (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                    <div className="text-red-400 text-sm">{bundleResults.error}</div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {bundleResults.liquidityTxHash && (
                      <div className="bg-black/40 rounded-lg p-3 border border-white/10">
                        <span className="text-white/60 text-sm font-open-sans">Liquidity Transaction:</span>
                        <div className="text-purple-300 font-mono text-xs break-all mt-1">
                          {bundleResults.liquidityTxHash}
                        </div>
                      </div>
                    )}
                    
                    {bundleResults.buyTxHashes.length > 0 && (
                      <div className="bg-black/40 rounded-lg p-3 border border-white/10">
                        <span className="text-white/60 text-sm font-open-sans">Buy Transactions:</span>
                        <div className="space-y-2 mt-1">
                          {bundleResults.buyTxHashes.map((hash, index) => (
                            <div key={index} className="text-purple-300 font-mono text-xs break-all">
                              {hash}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Transaction Status */}
            {isAddingLiquidity && renderTransactionStatus()}

            {/* Success/Error Messages */}
            {liquiditySuccess && (
              <div className="mt-6 bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                <div className="text-green-400 text-sm">{liquiditySuccess}</div>
              </div>
            )}
            {liquidityError && (
              <div className="mt-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                <div className="text-red-400 text-sm">{liquidityError}</div>
              </div>
            )}
          </div>

          {/* Automated Buying Section */}
          <div className="bg-black/20 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
            <h3 className="text-xl font-bold text-white mb-6 font-space-grotesk">Automated Buying</h3>
            <div className="flex items-center justify-between mb-4">
              <label htmlFor="autoBuyToggle" className="text-white/80 font-open-sans">Enable Automated Buying</label>
              <input
                type="checkbox"
                id="autoBuyToggle"
                className="w-5 h-5 text-purple-500 bg-black/50 border-white/20 rounded focus:ring-purple-500 focus:ring-2"
                checked={autoBuyEnabled}
                onChange={(e) => setAutoBuyEnabled(e.target.checked)}
              />
            </div>

            {autoBuyEnabled && (
              <div className="space-y-4 mt-6">
                <h4 className="text-lg font-bold text-white mb-4 font-space-grotesk">Auto-Buy Wallets</h4>
                {autoBuyWallets.map((wallet, index) => (
                  <div key={index} className="bg-black/30 rounded-xl p-4 border border-white/10">
                    <div className="flex items-center justify-between mb-4">
                      <h5 className="text-white/80 font-medium font-open-sans">Wallet {index + 1}</h5>
                      <input
                        type="checkbox"
                        className="w-4 h-4 text-purple-500 bg-black/50 border-white/20 rounded focus:ring-purple-500 focus:ring-2"
                        checked={wallet.enabled}
                        onChange={(e) => {
                          const newWallets = [...autoBuyWallets];
                          newWallets[index].enabled = e.target.checked;
                          setAutoBuyWallets(newWallets);
                        }}
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-white/80 text-sm font-medium mb-2 font-open-sans">Private Key</label>
                        <input
                          type="password"
                          className="w-full px-4 py-3 bg-black/40 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-all duration-200"
                          value={wallet.privateKey}
                          onChange={(e) => {
                            const newWallets = [...autoBuyWallets];
                            newWallets[index].privateKey = e.target.value;
                            setAutoBuyWallets(newWallets);
                          }}
                          placeholder="Enter private key"
                        />
                      </div>
                      <div>
                        <label className="block text-white/80 text-sm font-medium mb-2 font-open-sans">MATIC/ETH Amount</label>
                        <input
                          type="number"
                          min="0.001"
                          step="0.001"
                          className="w-full px-4 py-3 bg-black/40 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-all duration-200"
                          value={wallet.maticAmount}
                          onChange={(e) => {
                            const newWallets = [...autoBuyWallets];
                            newWallets[index].maticAmount = e.target.value;
                            setAutoBuyWallets(newWallets);
                          }}
                          placeholder="e.g., 0.1"
                        />
                      </div>
                    </div>
                    {wallet.privateKey && !validatePrivateKey(wallet.privateKey) && (
                      <div className="text-red-400 text-sm mt-2">Invalid Private Key</div>
                    )}
                  </div>
                ))}
                <button 
                  className="w-full px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-semibold rounded-xl transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => executeAutoBuy(liquidityTokenDetails?.address || (deploymentResult?.address || ''))}
                  disabled={isAutoBuying || !liquidityTokenDetails && !deploymentResult}
                >
                  {isAutoBuying ? 'Executing Auto-Buys...' : 'Execute Auto-Buys'}
                </button>

                {isAutoBuying && (
                  <div className="mt-6">
                    <h4 className="text-lg font-bold text-white mb-4 font-space-grotesk">Auto-Buy Results</h4>
                    <div className="space-y-3">
                      {autoBuyResults.map((result, index) => (
                        <div key={index} className={`bg-black/30 rounded-xl p-4 border ${
                          result.success ? 'border-green-500/30' : 'border-red-500/30'
                        }`}>
                          <div className="flex items-center justify-between text-white/80 text-sm font-open-sans">
                            <span>Wallet {result.walletIndex + 1}: {result.address?.slice(0, 8)}...{result.address?.slice(-6)}</span>
                            <span className={`font-semibold ${
                              result.success ? 'text-green-400' : 'text-red-400'
                            }`}>
                              {result.success ? 'SUCCESS' : 'FAILED'}
                            </span>
                          </div>
                          {result.txHash && (
                            <div className="text-white/60 text-xs font-mono break-all mt-2">
                              Tx: <a href={`https://etherscan.io/tx/${result.txHash}`} target="_blank" rel="noopener noreferrer" className="text-purple-300 hover:underline">{result.txHash}</a>
                            </div>
                          )}
                          {result.amountReceived && (
                            <div className="text-white/60 text-xs mt-1">
                              Received: {formatNumber(result.amountReceived)} {liquidityTokenDetails?.symbol || contractDetails.symbol}
                            </div>
                          )}
                          {result.error && (
                            <div className="text-red-300 text-xs mt-1">
                              Error: {result.error}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-black/20 backdrop-blur-xl rounded-2xl border border-white/10 p-6 text-center">
          <h3 className="text-xl font-bold text-white mb-4 font-space-grotesk">No Token Selected</h3>
          <p className="text-white/60 font-dm-sans">Please load a token contract address or deploy a new token to manage its liquidity.</p>
        </div>
      )}
    </div>
  );
} 