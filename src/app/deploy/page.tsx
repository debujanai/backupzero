'use client';

import { useState, useRef, useEffect } from 'react';
import { TabType } from '@/types';
import { useWallet } from '@/hooks/useWallet';
import { useContractDeployment } from '@/hooks/useContractDeployment';
import { Layout } from '@/components/Layout';
import { DeployTab } from '@/components/DeployTab';
import { LiquidityTab } from '@/components/LiquidityTab';
import { ManageTab } from '@/components/ManageTab';
import { SwapTab } from '@/components/SwapTab';

export default function ContractDeploy() {
  // Core state
  const [activeTab, setActiveTab] = useState<TabType>('deploy');
  
  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Custom hooks
  const { 
    isConnected, 
    account, 
    chainId, 
    provider, 
    signer, 
    connectWallet, 
    disconnectWallet 
  } = useWallet();

  const {
    contractDetails,
    setContractDetails,
    isDeploying,
    deploymentResult,
    deploymentError,
    deploymentProgress,
    deploymentStatus,
    handleAutoGenerate,
    handleDeploy: baseHandleDeploy,
    handleFeatureToggle,
    handleLogoUpload
  } = useContractDeployment();

  // Wrapper for deploy function to pass required parameters
  const handleDeploy = async () => {
    if (!signer || !provider) {
      alert('Please connect your wallet first');
      return;
    }
    await baseHandleDeploy(signer, provider, chainId);
  };

  const getBlockExplorerUrl = (address: string) => {
    switch (chainId) {
      case 1: return `https://etherscan.io/address/${address}`;
      case 137: return `https://polygonscan.com/address/${address}`;
      case 56: return `https://bscscan.com/address/${address}`;
      case 8453: return `https://basescan.org/address/${address}`;
      case 42161: return `https://arbiscan.io/address/${address}`;
      case 10: return `https://optimistic.etherscan.io/address/${address}`;
      default: return `https://etherscan.io/address/${address}`;
    }
  };

  return (
    <Layout activeTab={activeTab} setActiveTab={setActiveTab}>
      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold text-white mb-2 font-space-grotesk">
          {activeTab === 'deploy' && 'Token Deployment'}
          {activeTab === 'liquidity' && 'Liquidity Management'}
          {activeTab === 'swap' && 'Token Swap'}
          {activeTab === 'manage' && 'Token Management'}
        </h1>
        <p className="text-white/60 font-dm-sans">
          {activeTab === 'deploy' && 'Deploy your custom ERC-20 token with advanced features'}
          {activeTab === 'liquidity' && 'Add liquidity to decentralized exchanges'}
          {activeTab === 'swap' && 'Swap tokens using Uniswap with detailed transaction tracking'}
          {activeTab === 'manage' && 'Manage your deployed token contracts'}
        </p>
      </div>

      {/* Tab Content */}
      <div className="bg-black/20 backdrop-blur-xl rounded-2xl border border-white/10 p-8">
        {activeTab === 'deploy' && (
          <DeployTab
            contractDetails={contractDetails}
            setContractDetails={setContractDetails}
            isDeploying={isDeploying}
            deploymentResult={deploymentResult}
            deploymentError={deploymentError}
            deploymentProgress={deploymentProgress}
            deploymentStatus={deploymentStatus}
            handleAutoGenerate={handleAutoGenerate}
            handleDeploy={handleDeploy}
            handleFeatureToggle={handleFeatureToggle}
            handleLogoUpload={handleLogoUpload}
            getBlockExplorerUrl={getBlockExplorerUrl}
            fileInputRef={fileInputRef}
          />
        )}

        {activeTab === 'liquidity' && (
          <LiquidityTab
            provider={provider}
            signer={signer}
            account={account}
            chainId={chainId}
            contractDetails={contractDetails}
            setContractDetails={setContractDetails}
            deploymentResult={deploymentResult}
          />
        )}

        {activeTab === 'swap' && (
          <SwapTab
            provider={provider}
            signer={signer}
            account={account}
            chainId={chainId}
          />
        )}

        {activeTab === 'manage' && (
          <ManageTab
            provider={provider}
            signer={signer}
            account={account}
          />
        )}
      </div>
    </Layout>
  );
}
