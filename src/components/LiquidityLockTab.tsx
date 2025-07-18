'use client';

import { useEffect, useMemo } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import GlassCard from './GlassCard';
import { useRouter } from 'next/navigation';

// Map of Ethereum chain IDs to UNCX chain parameters
const CHAIN_MAPPING: Record<string, string> = {
  '0x1': '1',      // Ethereum Mainnet
  '0x89': '137',   // Polygon
  '0x38': '56',    // BNB Chain
  '0xa86a': '43114', // Avalanche
  '0xa': '10',     // Optimism
  '0xa4b1': '42161', // Arbitrum
  '0xfa': '250',   // Fantom
  '0x19': '25',    // Cronos
};

const LiquidityLockTab = () => {
  const { isConnected, address, chainId } = useWallet();
  const router = useRouter();

  // Determine the appropriate chain parameter for UNCX
  const uncxChain = useMemo(() => {
    if (!chainId) return '137'; // Default to Polygon if no chain ID
    return CHAIN_MAPPING[chainId] || '137'; // Fall back to Polygon if chain not supported
  }, [chainId]);

  const handleRedirectToUNCX = () => {
    if (!address) {
      alert('Please connect your wallet first');
      return;
    }
    
    const uncxUrl = `https://app.uncx.network/lockers/manage/lockers-v3?service=lock&wallet=${address}&chain=${uncxChain}`;
    window.open(uncxUrl, '_blank');
  };

  return (
    <GlassCard className="p-6">
      <div className="flex flex-col space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Liquidity Locking</h2>
          <div className="flex items-center space-x-2">
            <div className="h-2 w-2 rounded-full bg-green-500"></div>
            <span className="text-sm text-white/70">Powered by UNCX</span>
          </div>
        </div>
        
        <p className="text-white/80">
          Lock your liquidity with UNCX to boost trust, enhance your token's safety score, 
          and earn a badge displayed on top charting platforms.
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white/5 p-4 rounded-lg border border-white/10">
            <div className="text-purple-400 mb-2">🔒 Trust</div>
            <p className="text-sm text-white/70">Boost your community's trust and enhance your token's safety score</p>
          </div>
          <div className="bg-white/5 p-4 rounded-lg border border-white/10">
            <div className="text-purple-400 mb-2">🏆 Recognition</div>
            <p className="text-sm text-white/70">Earn a badge displayed on top charting platforms</p>
          </div>
          <div className="bg-white/5 p-4 rounded-lg border border-white/10">
            <div className="text-purple-400 mb-2">🔄 Flexibility</div>
            <p className="text-sm text-white/70">Extension of unlock dates and ownership transfer options</p>
          </div>
        </div>
        
        {chainId && !CHAIN_MAPPING[chainId] && (
          <div className="bg-yellow-500/20 border border-yellow-500/30 text-yellow-200 p-3 rounded-lg text-sm">
            <div className="flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span>Your current network is not supported by UNCX. Redirecting to Polygon by default.</span>
            </div>
          </div>
        )}
        
        <button
          onClick={handleRedirectToUNCX}
          disabled={!isConnected}
          className={`
            flex items-center justify-center gap-2 px-6 py-3 
            rounded-lg font-medium text-white
            transition-all duration-200 
            ${isConnected 
              ? 'bg-gradient-to-r from-purple-500 to-blue-500 hover:shadow-lg hover:shadow-purple-500/20 active:scale-95' 
              : 'bg-gray-600 cursor-not-allowed opacity-50'
            }
          `}
        >
          {isConnected ? (
            <>
              <span>Lock Liquidity on UNCX</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            </>
          ) : (
            <span>Connect Wallet to Lock Liquidity</span>
          )}
        </button>
      </div>
    </GlassCard>
  );
};

export default LiquidityLockTab;
