import React, { useState } from 'react';
import { ethers } from 'ethers';
import { ERC20_ABI } from '@/constants/contracts';
import { getNetworkSymbol, getRouterAddress } from '@/utils/blockchain';

interface EnableTradingTabProps {
  provider: ethers.BrowserProvider | null;
  signer: ethers.JsonRpcSigner | null;
  account: string;
  chainId: number;
}

const OPEN_TRADING_ABI = [
  'function openTrading() external',
];

const UNISWAP_V2_ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
  "function WETH() external pure returns (address)"
];

const V3_FEE_TIERS = [100, 500, 3000, 10000];

const getDefaultRpcUrl = (chainId: number): string => {
  switch (chainId) {
    case 1: return 'https://mainnet.infura.io/v3/013026c83db84ec49fb9ed5c473cede0';
    case 137: return 'https://polygon-mainnet.infura.io/v3/f28e7f77067d437d838bf32201e1386e';
    case 56: return 'https://bsc-dataseed.binance.org';
    case 8453: return 'https://mainnet.base.org';
    case 42161: return 'https://arb1.arbitrum.io/rpc';
    case 10: return 'https://mainnet.optimism.io';
    case 11155111: return 'https://sepolia.infura.io/v3/013026c83db84ec49fb9ed5c473cede0';
    default: return 'https://polygon-rpc.com';
  }
};

const EnableTradingTab: React.FC<EnableTradingTabProps> = ({ provider, signer, account, chainId }) => {
  const [tokenAddress, setTokenAddress] = useState('');
  const [txDetails, setTxDetails] = useState<any>(null);
  const [isEnabling, setIsEnabling] = useState(false);
  const [error, setError] = useState('');

  // --- Automated Buying System (moved from LiquidityTab) ---
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

  // Add state for private key based enable trading
  const [pkTokenAddress, setPkTokenAddress] = useState('');
  const [pk, setPk] = useState('');
  const [pkTxHash, setPkTxHash] = useState('');
  const [pkTxStatus, setPkTxStatus] = useState<'idle'|'pending'|'success'|'error'>('idle');
  const [pkError, setPkError] = useState('');

  const handleEnableTrading = async () => {
    setError('');
    setIsEnabling(true);
    setTxDetails(null);
    try {
      if (!signer) throw new Error('Wallet not connected');
      if (!ethers.isAddress(tokenAddress)) throw new Error('Invalid token address');
      const contract = new ethers.Contract(tokenAddress, OPEN_TRADING_ABI, signer);
      const tx = await contract.openTrading();
      const receipt = await tx.wait();
      setTxDetails({
        hash: tx.hash,
        status: receipt.status === 1 ? 'Success' : 'Failed',
        blockNumber: receipt.blockNumber,
        confirmations: receipt.confirmations,
        timestamp: Date.now(),
        from: tx.from,
        to: tx.to,
        value: tx.value ? ethers.formatEther(tx.value) : '0',
        gasPrice: tx.gasPrice ? ethers.formatUnits(tx.gasPrice, 'gwei') : '',
        gasLimit: tx.gasLimit ? tx.gasLimit.toString() : '',
        gasUsed: receipt.gasUsed ? receipt.gasUsed.toString() : '',
        transactionFee: receipt.gasUsed && tx.gasPrice ? ethers.formatEther(receipt.gasUsed * tx.gasPrice) : '',
        nonce: tx.nonce,
        methodId: '0xc9567bf9',
        functionName: 'openTrading()',
      });
    } catch (e: any) {
      setError(e.message || 'Failed to enable trading');
    } finally {
      setIsEnabling(false);
    }
  };

  const handleEnableTradingWithPK = async () => {
    setPkTxStatus('pending');
    setPkTxHash('');
    setPkError('');
    try {
      if (!pkTokenAddress || !pk) throw new Error('Token address and private key required');
      let priv = pk;
      if (!priv.startsWith('0x')) priv = '0x' + priv;
      const rpcUrl = getDefaultRpcUrl(chainId);
      const customProvider = new ethers.JsonRpcProvider(rpcUrl);
      const wallet = new ethers.Wallet(priv, customProvider);
      const contract = new ethers.Contract(pkTokenAddress, OPEN_TRADING_ABI, wallet);
      const tx = await contract.openTrading();
      setPkTxHash(tx.hash);
      await tx.wait();
      setPkTxStatus('success');
    } catch (e: any) {
      setPkError(e.message || 'Failed to enable trading');
      setPkTxStatus('error');
    }
  };

  const executeAutoBuy = async (tokenAddress: string) => {
    if (!autoBuyEnabled) return;
    setIsAutoBuying(true);
    setAutoBuyResults([]);
    const results: typeof autoBuyResults = [];
    for (let i = 0; i < autoBuyWallets.length; i++) {
      const wallet = autoBuyWallets[i];
      if (!wallet.enabled || !wallet.privateKey || !wallet.maticAmount) continue;
      try {
        const rpcUrl = getDefaultRpcUrl(chainId);
        const customProvider = new ethers.JsonRpcProvider(rpcUrl);
        const buyerWallet = new ethers.Wallet(wallet.privateKey, customProvider);
        const buyerAddress = await buyerWallet.getAddress();
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
      const deadline = Math.floor(Date.now() / 1000) + 1200;
      // Only V2 for simplicity
      const v2Result = await executeBuyV2(wallet, customProvider, tokenAddress, amountIn, deadline);
      return v2Result;
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
      const wethAddress = await router.WETH();
      const path = [wethAddress, tokenAddress];
      const amounts = await router.getAmountsOut(amountIn, path);
      const amountOut = amounts[amounts.length - 1];
      const amountOutMin = (amountOut * BigInt(98)) / BigInt(100);
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
          amountReceived: ethers.formatUnits(amountOut, 18)
        };
      } else {
        return { success: false, error: 'Transaction failed' };
      }
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  };

  // --- Automated Buying UI ---
  const renderTxDetails = () => {
    if (!txDetails) return null;
    return (
      <div className="bg-black/20 backdrop-blur-xl rounded-2xl border border-white/10 p-6 mt-6">
        <h4 className="text-lg font-bold text-white mb-4 font-space-grotesk">Transaction Action</h4>
        <div className="mb-2 text-white/80">Call <b>Open Trading</b></div>
        <div className="mb-2 text-white/60 text-xs">Function by</div>
        <div className="mb-2 text-purple-300 font-mono text-xs">{txDetails.from}</div>
        <div className="mb-2 text-white/60 text-xs">on</div>
        <div className="mb-2 text-purple-300 font-mono text-xs">{txDetails.to}</div>
        <div className="mb-2 text-white/60 text-xs">Transaction Hash:</div>
        <div className="mb-2 text-purple-300 font-mono text-xs break-all">{txDetails.hash}</div>
        <div className="mb-2 text-white/60 text-xs">Status:</div>
        <div className={`mb-2 font-bold ${txDetails.status === 'Success' ? 'text-green-400' : 'text-red-400'}`}>{txDetails.status}</div>
        <div className="mb-2 text-white/60 text-xs">Block:</div>
        <div className="mb-2 text-white/80">{txDetails.blockNumber}</div>
        <div className="mb-2 text-white/60 text-xs">Confirmations:</div>
        <div className="mb-2 text-white/80">{txDetails.confirmations}</div>
        <div className="mb-2 text-white/60 text-xs">From:</div>
        <div className="mb-2 text-purple-300 font-mono text-xs">{txDetails.from}</div>
        <div className="mb-2 text-white/60 text-xs">To:</div>
        <div className="mb-2 text-purple-300 font-mono text-xs">{txDetails.to}</div>
        <div className="mb-2 text-white/60 text-xs">Value:</div>
        <div className="mb-2 text-white/80">{txDetails.value} ETH</div>
        <div className="mb-2 text-white/60 text-xs">Transaction Fee:</div>
        <div className="mb-2 text-white/80">{txDetails.transactionFee} ETH</div>
        <div className="mb-2 text-white/60 text-xs">Gas Price:</div>
        <div className="mb-2 text-white/80">{txDetails.gasPrice} Gwei</div>
        <div className="mb-2 text-white/60 text-xs">Gas Limit & Usage:</div>
        <div className="mb-2 text-white/80">{txDetails.gasLimit} | {txDetails.gasUsed}</div>
        <div className="mb-2 text-white/60 text-xs">Txn Type:</div>
        <div className="mb-2 text-white/80">2 (EIP-1559)</div>
        <div className="mb-2 text-white/60 text-xs">Nonce:</div>
        <div className="mb-2 text-white/80">{txDetails.nonce}</div>
        <div className="mb-2 text-white/60 text-xs">Input Data:</div>
        <div className="mb-2 text-white/80">Function: {txDetails.functionName}</div>
        <div className="mb-2 text-white/80">MethodID: {txDetails.methodId}</div>
      </div>
    );
  };

  // Add a helper for private key validation
  const isValidPrivateKey = (key: string) => {
    try {
      let k = key;
      if (!k.startsWith('0x')) k = '0x' + k;
      new ethers.Wallet(k);
      return true;
    } catch {
      return false;
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-black/20 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
        <h3 className="text-xl font-bold text-white mb-6 font-space-grotesk">Enable Trading</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-white/80 text-sm font-medium mb-2 font-open-sans">Token Address</label>
            <input
              type="text"
              className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-all duration-200"
              value={tokenAddress}
              onChange={e => setTokenAddress(e.target.value)}
              placeholder="Enter your token contract address"
            />
          </div>
          <button
            className="px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-semibold rounded-xl transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleEnableTrading}
            disabled={isEnabling || !tokenAddress}
          >
            {isEnabling ? 'Enabling Trading...' : 'Enable Trading (openTrading)'}
          </button>
          {error && <div className="text-red-400 text-sm mt-2">{error}</div>}
        </div>
      </div>
      {renderTxDetails()}
      <div className="bg-black/20 backdrop-blur-xl rounded-2xl border border-white/10 p-6 mt-8">
        <h3 className="text-xl font-bold text-white mb-6 font-space-grotesk">Enable Trading with Private Key</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-white/80 text-sm font-medium mb-2 font-open-sans">Token Address</label>
            <input
              type="text"
              className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-all duration-200"
              value={pkTokenAddress}
              onChange={e => setPkTokenAddress(e.target.value)}
              placeholder="Enter your token contract address"
            />
          </div>
          <div>
            <label className="block text-white/80 text-sm font-medium mb-2 font-open-sans">Owner Private Key</label>
            <input
              type="password"
              className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-all duration-200"
              value={pk}
              onChange={e => setPk(e.target.value)}
              placeholder="Enter owner private key"
            />
          </div>
          <button
            className="px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-semibold rounded-xl transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleEnableTradingWithPK}
            disabled={pkTxStatus === 'pending' || !pkTokenAddress || !pk}
          >
            {pkTxStatus === 'pending' ? 'Enabling Trading...' : 'Enable Trading (Private Key)'}
          </button>
          {pkTxStatus === 'success' && pkTxHash && (
            <div className="text-green-400 text-sm mt-2">Success! Tx Hash: <a href={`https://sepolia.etherscan.io/tx/${pkTxHash}`} target="_blank" rel="noopener noreferrer" className="text-purple-300 hover:underline">{pkTxHash}</a></div>
          )}
          {pkTxStatus === 'error' && pkError && (
            <div className="text-red-400 text-sm mt-2">{pkError}</div>
          )}
        </div>
      </div>
      <div className="bg-black/20 backdrop-blur-xl rounded-2xl border border-white/10 p-6 mt-8">
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
                {wallet.privateKey && wallet.privateKey.length > 0 && !isValidPrivateKey(wallet.privateKey) && (
                  <div className="text-red-400 text-sm mt-2">Invalid Private Key</div>
                )}
              </div>
            ))}
            <button 
              className="w-full px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-semibold rounded-xl transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => executeAutoBuy(tokenAddress)}
              disabled={isAutoBuying || !tokenAddress}
            >
              {isAutoBuying ? 'Executing Auto-Buys...' : 'Execute Auto-Buys'}
            </button>
            {(autoBuyResults.length > 0 || isAutoBuying) && (
              <div className="mt-6">
                <h4 className="text-lg font-bold text-white mb-4 font-space-grotesk">Auto-Buy Results</h4>
                {isAutoBuying && (
                  <div className="text-yellow-400 text-sm mb-2">Executing auto-buys...</div>
                )}
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
                          Received: {result.amountReceived}
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
  );
};

export default EnableTradingTab; 