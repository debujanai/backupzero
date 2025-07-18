'use client';

import { useState } from 'react';
import { ethers } from 'ethers';
import { ERC20_ABI, OWNABLE_ABI } from '@/constants/contracts';
import { formatNumber } from '@/utils/blockchain';

interface ManageTabProps {
  provider: ethers.BrowserProvider | null;
  signer: ethers.JsonRpcSigner | null;
  account: string;
}

export function ManageTab({ provider, signer, account }: ManageTabProps) {
  // Management state
  const [manageTokenAddress, setManageTokenAddress] = useState('');
  const [manageTokenDetails, setManageTokenDetails] = useState<any>(null);
  const [isLoadingManageToken, setIsLoadingManageToken] = useState(false);
  const [isRenouncing, setIsRenouncing] = useState(false);

  const fetchManageTokenDetails = async () => {
    if (!provider || !manageTokenAddress) {
      alert('Please enter a token address');
      return;
    }

    if (!ethers.isAddress(manageTokenAddress)) {
      alert('Please enter a valid token address');
      return;
    }

    setIsLoadingManageToken(true);
    setManageTokenDetails(null);

    try {
      const tokenContract = new ethers.Contract(manageTokenAddress, ERC20_ABI, provider);
      const ownableContract = new ethers.Contract(manageTokenAddress, OWNABLE_ABI, provider);
      
      const [name, symbol, decimals, totalSupply, owner] = await Promise.all([
        tokenContract.name().catch(() => 'Unknown'),
        tokenContract.symbol().catch(() => 'UNKNOWN'),
        tokenContract.decimals().catch(() => 18),
        tokenContract.totalSupply().catch(() => BigInt(0)),
        ownableContract.owner().catch(() => ethers.ZeroAddress)
      ]);

      const balance = await tokenContract.balanceOf(account).catch(() => BigInt(0));

      setManageTokenDetails({
        address: manageTokenAddress,
        name,
        symbol,
        decimals,
        totalSupply: ethers.formatUnits(totalSupply, decimals),
        balance: ethers.formatUnits(balance, decimals),
        owner,
        isOwner: owner.toLowerCase() === account.toLowerCase(),
        canRenounce: owner !== ethers.ZeroAddress && owner.toLowerCase() === account.toLowerCase()
      });
    } catch (error) {
      console.error('Error fetching token details:', error);
      alert('Failed to fetch token details. Please check the address and try again.');
    } finally {
      setIsLoadingManageToken(false);
    }
  };

  const renounceContractOwnership = async () => {
    if (!signer || !manageTokenDetails) {
      alert('Please connect wallet and load token details first');
      return;
    }

    if (!manageTokenDetails.canRenounce) {
      alert('You are not the owner of this contract or ownership has already been renounced');
      return;
    }

    const confirmRenounce = window.confirm(
      'Are you sure you want to renounce ownership of this contract? This action cannot be undone and you will lose all administrative privileges.'
    );

    if (!confirmRenounce) return;

    setIsRenouncing(true);
    try {
      const ownableContract = new ethers.Contract(manageTokenDetails.address, OWNABLE_ABI, signer);
      
      const tx = await ownableContract.renounceOwnership();
      await tx.wait();
      
      alert('Ownership renounced successfully!');
      
      // Refresh token details
      await fetchManageTokenDetails();
    } catch (error: any) {
      console.error('Error renouncing ownership:', error);
      alert(`Failed to renounce ownership: ${error.message}`);
    } finally {
      setIsRenouncing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Token Address Input */}
      <div className="bg-black/20 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
        <h3 className="text-xl font-bold text-white mb-6 font-space-grotesk">Load Token Contract</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-white/80 text-sm font-medium mb-2 font-open-sans">Token Address</label>
            <input
              type="text"
              className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-all duration-200"
              value={manageTokenAddress}
              onChange={(e) => setManageTokenAddress(e.target.value)}
              placeholder="Enter token contract address"
            />
          </div>
          <button 
            className="px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-semibold rounded-xl transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={fetchManageTokenDetails} 
            disabled={isLoadingManageToken}
          >
            {isLoadingManageToken ? 'Loading...' : 'Load Token Details'}
          </button>
        </div>
      </div>

      {/* Token Details */}
      {manageTokenDetails && (
        <div className="bg-black/20 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
          <h3 className="text-xl font-bold text-white mb-6 font-space-grotesk">Token Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-black/30 rounded-xl p-4 border border-white/10">
              <span className="text-white/60 text-sm font-open-sans">Name</span>
              <div className="text-white font-semibold mt-1">{manageTokenDetails.name}</div>
            </div>
            <div className="bg-black/30 rounded-xl p-4 border border-white/10">
              <span className="text-white/60 text-sm font-open-sans">Symbol</span>
              <div className="text-white font-semibold mt-1">{manageTokenDetails.symbol}</div>
            </div>
            <div className="bg-black/30 rounded-xl p-4 border border-white/10">
              <span className="text-white/60 text-sm font-open-sans">Decimals</span>
              <div className="text-white font-semibold mt-1">{manageTokenDetails.decimals}</div>
            </div>
            <div className="bg-black/30 rounded-xl p-4 border border-white/10">
              <span className="text-white/60 text-sm font-open-sans">Total Supply</span>
              <div className="text-white font-semibold mt-1">{formatNumber(manageTokenDetails.totalSupply)}</div>
            </div>
            <div className="bg-black/30 rounded-xl p-4 border border-white/10">
              <span className="text-white/60 text-sm font-open-sans">Your Balance</span>
              <div className="text-white font-semibold mt-1">{formatNumber(manageTokenDetails.balance || '0')}</div>
            </div>
            <div className="bg-black/30 rounded-xl p-4 border border-white/10">
              <span className="text-white/60 text-sm font-open-sans">Contract Address</span>
              <div className="text-purple-300 font-mono text-sm break-all mt-1">{manageTokenDetails.address}</div>
            </div>
          </div>
        </div>
      )}

      {/* Ownership Information */}
      {manageTokenDetails && (
        <div className="bg-black/20 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
          <h3 className="text-xl font-bold text-white mb-6 font-space-grotesk">Ownership Information</h3>
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-black/30 rounded-xl p-4 border border-white/10">
                <span className="text-white/60 text-sm font-open-sans">Current Owner</span>
                <div className="text-purple-300 font-mono text-sm break-all mt-1">{manageTokenDetails.owner}</div>
              </div>
              <div className="bg-black/30 rounded-xl p-4 border border-white/10">
                <span className="text-white/60 text-sm font-open-sans">You Are Owner</span>
                <div className={`font-semibold mt-1 ${manageTokenDetails.isOwner ? 'text-green-400' : 'text-white/40'}`}>
                  {manageTokenDetails.isOwner ? 'Yes' : 'No'}
                </div>
              </div>
            </div>
            
            {manageTokenDetails.canRenounce && (
              <div className="bg-red-500/10 rounded-xl p-4 border border-red-500/30">
                <div className="flex items-start gap-4">
                  <div className="text-red-400 mt-1">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/>
                      <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-red-400 font-semibold mb-2 font-open-sans">Renounce Ownership</h4>
                    <p className="text-red-300 text-sm font-dm-sans">This action cannot be undone and you will lose all administrative privileges over this contract.</p>
                  </div>
                </div>
                <button 
                  className="mt-4 px-6 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-300 font-semibold rounded-xl transition-all duration-200 border border-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={renounceContractOwnership}
                  disabled={isRenouncing}
                >
                  {isRenouncing ? 'Renouncing...' : 'Renounce Ownership'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
} 