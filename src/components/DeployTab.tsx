'use client';

import { RefObject } from 'react';
import { ContractDetails, DeploymentResult } from '@/types';
import { FEATURES } from '@/constants/networks';

interface DeployTabProps {
  contractDetails: ContractDetails;
  setContractDetails: (details: ContractDetails | ((prev: ContractDetails) => ContractDetails)) => void;
  isDeploying: boolean;
  deploymentResult: DeploymentResult | null;
  deploymentError: string;
  deploymentProgress: number;
  deploymentStatus: string;
  handleAutoGenerate: () => void;
  handleDeploy: () => void;
  handleFeatureToggle: (featureId: string) => void;
  handleLogoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  getBlockExplorerUrl: (address: string) => string;
  fileInputRef: RefObject<HTMLInputElement | null>;
}

export function DeployTab({
  contractDetails,
  setContractDetails,
  isDeploying,
  deploymentResult,
  deploymentError,
  deploymentProgress,
  deploymentStatus,
  handleAutoGenerate,
  handleDeploy,
  handleFeatureToggle,
  handleLogoUpload,
  getBlockExplorerUrl,
  fileInputRef
}: DeployTabProps) {
  return (
    <div className="space-y-6">
      {/* Action Buttons */}
      <div className="flex gap-4 mb-6">
        <button 
          className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl transition-all duration-200 border border-white/20"
          onClick={handleAutoGenerate}
        >
          Auto Generate
        </button>
        <button 
          className="px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-semibold rounded-xl transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleDeploy} 
          disabled={isDeploying}
        >
          {isDeploying ? 'Deploying...' : 'Deploy Contract'}
        </button>
      </div>

      {/* Basic Contract Details */}
      <div className="bg-black/20 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
        <h3 className="text-xl font-bold text-white mb-6 font-space-grotesk">Basic Details</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div>
            <label className="block text-white/80 text-sm font-medium mb-2 font-open-sans">Token Name</label>
            <input
              type="text"
              className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-all duration-200"
              value={contractDetails.name}
              onChange={(e) => setContractDetails(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Enter token name"
            />
          </div>
          <div>
            <label className="block text-white/80 text-sm font-medium mb-2 font-open-sans">Symbol</label>
            <input
              type="text"
              className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-all duration-200"
              value={contractDetails.symbol}
              onChange={(e) => setContractDetails(prev => ({ ...prev, symbol: e.target.value }))}
              placeholder="Enter token symbol"
            />
          </div>
          <div>
            <label className="block text-white/80 text-sm font-medium mb-2 font-open-sans">Decimals</label>
            <input
              type="number"
              className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-all duration-200"
              value={contractDetails.decimals}
              onChange={(e) => setContractDetails(prev => ({ ...prev, decimals: e.target.value }))}
              placeholder="18"
            />
          </div>
          <div>
            <label className="block text-white/80 text-sm font-medium mb-2 font-open-sans">Total Supply</label>
            <input
              type="number"
              className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-all duration-200"
              value={contractDetails.totalSupply}
              onChange={(e) => setContractDetails(prev => ({ ...prev, totalSupply: e.target.value }))}
              placeholder="Enter total supply"
            />
          </div>
        </div>
        <div className="mb-6">
          <label className="block text-white/80 text-sm font-medium mb-2 font-open-sans">Description</label>
          <textarea
            className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-all duration-200 resize-none"
            value={contractDetails.description}
            onChange={(e) => setContractDetails(prev => ({ ...prev, description: e.target.value }))}
            placeholder="Enter token description"
            rows={3}
          />
        </div>
        <div>
          <label className="block text-white/80 text-sm font-medium mb-2 font-open-sans">Logo</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleLogoUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white/60 hover:text-white hover:border-purple-500 transition-all duration-200 text-center"
          >
            Choose Logo File
          </button>
          {contractDetails.logoUrl && (
            <div className="mt-4 flex items-center gap-4">
              <img src={contractDetails.logoUrl} alt="Logo" className="w-16 h-16 rounded-lg object-cover border border-white/20" />
              <span className="text-white/60 text-sm">Logo uploaded successfully</span>
            </div>
          )}
        </div>
      </div>

      {/* Tax Configuration */}
      <div className="bg-black/20 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
        <h3 className="text-xl font-bold text-white mb-6 font-space-grotesk">Tax Configuration</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-white/80 text-sm font-medium mb-2 font-open-sans">Buy Tax (%)</label>
            <input
              type="number"
              min="0"
              max="25"
              className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-all duration-200"
              value={contractDetails.buyTax}
              onChange={(e) => setContractDetails(prev => ({ ...prev, buyTax: parseInt(e.target.value) || 0 }))}
              placeholder="0"
            />
          </div>
          <div>
            <label className="block text-white/80 text-sm font-medium mb-2 font-open-sans">Sell Tax (%)</label>
            <input
              type="number"
              min="0"
              max="25"
              className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-all duration-200"
              value={contractDetails.sellTax}
              onChange={(e) => setContractDetails(prev => ({ ...prev, sellTax: parseInt(e.target.value) || 0 }))}
              placeholder="0"
            />
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="bg-black/20 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
        <h3 className="text-xl font-bold text-white mb-6 font-space-grotesk">Features</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(feature => (
            <div key={feature.id} className="bg-black/30 rounded-xl p-4 border border-white/10">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1 w-4 h-4 text-purple-500 bg-black/50 border-white/20 rounded focus:ring-purple-500 focus:ring-2"
                  checked={contractDetails.features.includes(feature.id)}
                  onChange={() => handleFeatureToggle(feature.id)}
                />
                <div className="flex-1">
                  <h4 className="text-white font-semibold mb-1 font-open-sans">{feature.name}</h4>
                  <p className="text-white/60 text-sm font-dm-sans">{feature.description}</p>
                </div>
              </label>
            </div>
          ))}
        </div>
      </div>

      {/* Deployment Progress */}
      {isDeploying && (
        <div className="bg-black/20 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
          <h3 className="text-xl font-bold text-white mb-4 font-space-grotesk">Deployment Progress</h3>
          <div className="space-y-4">
            <div className="w-full bg-black/30 rounded-full h-2">
              <div 
                className="bg-gradient-to-r from-purple-500 to-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${deploymentProgress}%` }}
              ></div>
            </div>
            <p className="text-white/80 font-dm-sans">{deploymentStatus}</p>
          </div>
        </div>
      )}

      {/* Deployment Result */}
      {deploymentResult && (
        <div className="bg-green-500/10 backdrop-blur-xl rounded-2xl border border-green-500/30 p-6">
          <h3 className="text-xl font-bold text-green-400 mb-4 font-space-grotesk">Deployment Successful!</h3>
          <div className="space-y-3">
            <div>
              <span className="text-white/80 text-sm font-open-sans">Contract Address:</span>
              <div className="text-green-300 font-mono text-sm break-all mt-1">{deploymentResult.address}</div>
            </div>
            <div>
              <span className="text-white/80 text-sm font-open-sans">Transaction Hash:</span>
              <div className="text-green-300 font-mono text-sm break-all mt-1">{deploymentResult.txHash}</div>
            </div>
            <div className="flex gap-3 pt-2">
              <a
                href={getBlockExplorerUrl(deploymentResult.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-green-500/20 hover:bg-green-500/30 text-green-300 rounded-lg transition-all duration-200 text-sm font-open-sans"
              >
                View on Explorer
              </a>
              <button
                onClick={() => navigator.clipboard.writeText(deploymentResult.address)}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-all duration-200 text-sm font-open-sans"
              >
                Copy Address
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deployment Error */}
      {deploymentError && (
        <div className="bg-red-500/10 backdrop-blur-xl rounded-2xl border border-red-500/30 p-6">
          <h3 className="text-xl font-bold text-red-400 mb-4 font-space-grotesk">Deployment Failed</h3>
          <p className="text-red-300 font-dm-sans">{deploymentError}</p>
        </div>
      )}
    </div>
  );
} 