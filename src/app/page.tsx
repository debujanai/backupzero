"use client";
import { useState } from "react";
import { ethers } from "ethers";
import { Layout } from "@/components/Layout";

export default function Home() {
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  async function connectWallet() {
    setError(null);
    if (!(window as any).ethereum) {
      setError("MetaMask is not installed");
      return;
    }
    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      setAddress(accounts[0]);
      setIsConnected(true);
    } catch (err: any) {
      setError(err.message || "Failed to connect");
    }
  }

  const disconnectWallet = () => {
    setAddress(null);
    setIsConnected(false);
    setError(null);
  };

  return (
    <Layout activeTab="dashboard">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2 font-space-grotesk">Welcome to dApp</h1>
        <p className="text-white/60 font-dm-sans">Connect your wallet to get started</p>
      </div>

      {/* Main Card */}
      <div className="bg-black/20 backdrop-blur-xl rounded-2xl border border-white/10 p-8">
        <div className="text-center">
          {!isConnected ? (
            <div className="space-y-6">
              <div className="w-20 h-20 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full mx-auto flex items-center justify-center">
                <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white mb-2 font-space-grotesk">Connect Your Wallet</h2>
                <p className="text-white/60 mb-6 font-dm-sans">Connect your MetaMask wallet to access the dApp</p>
              </div>
              <button
                onClick={connectWallet}
                className="px-8 py-4 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-semibold rounded-xl transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-purple-500/25 font-dm-sans"
              >
                Connect Wallet
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="w-20 h-20 bg-gradient-to-r from-green-500 to-emerald-500 rounded-full mx-auto flex items-center justify-center">
                <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white mb-2 font-space-grotesk">Wallet Connected!</h2>
                <p className="text-white/60 mb-4 font-dm-sans">Your wallet is successfully connected</p>
                <div className="bg-black/30 rounded-lg p-4 border border-white/10">
                  <div className="text-purple-300 font-mono text-sm break-all">
                    {address}
                  </div>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-6 p-4 bg-red-500/20 border border-red-500/30 rounded-lg">
              <div className="text-red-300 text-sm font-dm-sans">{error}</div>
            </div>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      {isConnected && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
          <div className="bg-black/20 backdrop-blur-xl rounded-xl border border-white/10 p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
              <h3 className="text-white/60 text-sm font-medium font-open-sans">Balance</h3>
            </div>
            <p className="text-2xl font-bold text-white font-space-grotesk">0.00 ETH</p>
          </div>
          <div className="bg-black/20 backdrop-blur-xl rounded-xl border border-white/10 p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
              <h3 className="text-white/60 text-sm font-medium font-open-sans">Network</h3>
            </div>
            <p className="text-2xl font-bold text-white font-space-grotesk">Ethereum</p>
          </div>
          <div className="bg-black/20 backdrop-blur-xl rounded-xl border border-white/10 p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              <h3 className="text-white/60 text-sm font-medium font-open-sans">Status</h3>
            </div>
            <p className="text-2xl font-bold text-white font-space-grotesk">Active</p>
          </div>
        </div>
      )}
    </Layout>
  );
}
