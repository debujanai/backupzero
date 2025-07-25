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
      case 11155111: return '0xE592427A0AEce92De3Edee1F18E0157C05861564'; // Sepolia
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
      case 11155111: return '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6'; // Sepolia
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
      case 11155111: return '0x1F98431c8aD98523631AE4a59f267346ea31F984'; // Sepolia
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

          const minTokenAmount = tokenAmount * BigInt(100 - Math.floor(liquidityDetails.slippage * 100)) / BigInt(100);
          const minNativeAmount = nativeAmount * BigInt(100 - Math.floor(liquidityDetails.slippage * 100)) / BigInt(100);

          const tx = await router.addLiquidityETH(
            tokenAddress,
            tokenAmount,
            minTokenAmount,
            minNativeAmount,
            userAddress,
            deadline,
            { value: nativeAmount }
          );

          const receipt = await tx.wait();
          setLiquiditySuccess(`Liquidity added successfully! Transaction: ${receipt.hash}`);
        } else {
          // Token-to-token liquidity
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
          const pairAllowance = await pairTokenContract.allowance(userAddress, routerAddress);
          if (pairAllowance < pairAmount) {
            const approveTx = await pairTokenContract.approve(routerAddress, pairAmount);
            await approveTx.wait();
          }

          const deadline = Math.floor(Date.now() / 1000) + 1200;
          const minTokenAmount = tokenAmount * BigInt(100 - Math.floor(liquidityDetails.slippage * 100)) / BigInt(100);
          const minPairAmount = pairAmount * BigInt(100 - Math.floor(liquidityDetails.slippage * 100)) / BigInt(100);

          const tx = await router.addLiquidity(
            tokenAddress,
            liquidityDetails.pairToken.address,
            tokenAmount,
            pairAmount,
            minTokenAmount,
            minPairAmount,
            userAddress,
            deadline
          );

          const receipt = await tx.wait();
          setLiquiditySuccess(`Liquidity added successfully! Transaction: ${receipt.hash}`);
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
      case 1: return 'https://mainnet.infura.io/v3/9bb89e8a800d438f89fcb188341a52c3'; // Ethereum
      case 137: return 'https://polygon-mainnet.infura.io/v3/f28e7f77067d437d838bf32201e1386e'; // Polygon
      case 56: return 'https://bsc-dataseed.binance.org'; // BSC
      case 8453: return 'https://mainnet.base.org'; // Base
      case 42161: return 'https://arb1.arbitrum.io/rpc'; // Arbitrum
      case 10: return 'https://mainnet.optimism.io'; // Optimism
      case 11155111: return 'https://sepolia.infura.io/v3/013026c83db84ec49fb9ed5c473cede0'; // Sepolia
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

          const minTokenAmount = tokenAmount * BigInt(100 - Math.floor(liquidityDetails.slippage * 100)) / BigInt(100);
          const minNativeAmount = nativeAmount * BigInt(100 - Math.floor(liquidityDetails.slippage * 100)) / BigInt(100);

          // Check if wallet has enough balance
          const balance = await privateProvider.getBalance(userAddress);
          if (balance < nativeAmount) {
            throw new Error(`Insufficient balance. Required: ${liquidityDetails.pairAmount} ${getNetworkSymbol(chainId)}, Available: ${ethers.formatEther(balance)} ${getNetworkSymbol(chainId)}`);
          }

          const tx = await router.addLiquidityETH(
            tokenAddress,
            tokenAmount,
            minTokenAmount,
            minNativeAmount,
            userAddress,
            deadline,
            { value: nativeAmount }
          );

          const receipt = await tx.wait();
          setLiquiditySuccess(`Liquidity added successfully! Transaction: ${receipt.hash}`);
        } else {
          // Token-to-token liquidity
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
          const pairAllowance = await pairTokenContract.allowance(userAddress, routerAddress);
          if (pairAllowance < pairAmount) {
            const approveTx = await pairTokenContract.approve(routerAddress, pairAmount);
            await approveTx.wait();
          }

          const deadline = Math.floor(Date.now() / 1000) + 1200;
          const minTokenAmount = tokenAmount * BigInt(100 - Math.floor(liquidityDetails.slippage * 100)) / BigInt(100);
          const minPairAmount = pairAmount * BigInt(100 - Math.floor(liquidityDetails.slippage * 100)) / BigInt(100);

          const tx = await router.addLiquidity(
            tokenAddress,
            liquidityDetails.pairToken.address,
            tokenAmount,
            pairAmount,
            minTokenAmount,
            minPairAmount,
            userAddress,
            deadline
          );

          const receipt = await tx.wait();
          setLiquiditySuccess(`Liquidity added successfully! Transaction: ${receipt.hash}`);
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
                onClick={autoLiquidityEnabled ? addLiquidityWithPrivateKey : addLiquidity}
                disabled={isAddingLiquidity}
              >
                {isAddingLiquidity ? 'Adding Liquidity...' : 'Add Liquidity'}
              </button>
            </div>

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