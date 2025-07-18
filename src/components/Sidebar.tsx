'use client';

import { useState } from 'react';
import { TabType } from '@/types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface SidebarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  isConnected: boolean;
  account: string;
  chainId: number;
  connectWallet: () => void;
  disconnectWallet: () => void;
  isMobileMenuOpen?: boolean;
  setIsMobileMenuOpen?: (open: boolean) => void;
}

export function Sidebar({ 
  activeTab, 
  setActiveTab, 
  isConnected, 
  account, 
  chainId, 
  connectWallet, 
  disconnectWallet,
  isMobileMenuOpen = false,
  setIsMobileMenuOpen
}: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const router = useRouter();

  const getNetworkName = (chainId: number) => {
    switch (chainId) {
      case 1: return 'Ethereum';
      case 137: return 'Polygon';
      case 56: return 'BSC';
      case 8453: return 'Base';
      case 42161: return 'Arbitrum';
      case 10: return 'Optimism';
      default: return 'Unknown';
    }
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setIsMobileMenuOpen?.(false);
    
    // Navigate to appropriate page
    if (tab === 'dashboard') {
      router.push('/');
    } else {
      router.push('/deploy');
    }
  };

  const navigationItems = [
    {
      id: 'dashboard' as TabType,
      label: 'Dashboard',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7"/>
          <rect x="14" y="3" width="7" height="7"/>
          <rect x="14" y="14" width="7" height="7"/>
          <rect x="3" y="14" width="7" height="7"/>
        </svg>
      )
    },
    {
      id: 'deploy' as TabType,
      label: 'Deploy Token',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2L2 7v10l10 5 10-5V7l-10-5z"/>
          <path d="M12 22V12"/>
          <path d="M2 7l10 5 10-5"/>
        </svg>
      )
    },
    {
      id: 'liquidity' as TabType,
      label: 'Liquidity',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2v20"/>
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
        </svg>
      )
    },
    {
      id: 'swap' as TabType,
      label: 'Swap',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M16 3h5v5"/>
          <path d="M8 21H3v-5"/>
          <path d="M21 8L8 21"/>
          <path d="M3 16l13-13"/>
        </svg>
      )
    },
    {
      id: 'manage' as TabType,
      label: 'Manage',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 1v6m0 6v6"/>
          <path d="M9 12H3m6 0h6"/>
        </svg>
      )
    }
  ];

  return (
    <div className={`w-80 bg-black/20 backdrop-blur-xl border-r border-white/10 p-6 transition-all duration-300 ${
      isCollapsed ? 'w-20' : 'w-80'
    } ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} fixed lg:relative z-50 h-full`}>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-blue-500 rounded-lg flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white">
                <path d="M12 2L2 7v10l10 5 10-5V7l-10-5z"/>
                <path d="M12 22V12"/>
                <path d="M2 7l10 5 10-5"/>
              </svg>
            </div>
            {!isCollapsed && (
              <span className="text-white font-bold text-xl font-space-grotesk">ZEROFY</span>
            )}
          </div>
          <button 
            className="text-white/60 hover:text-white p-2 rounded-lg hover:bg-white/5 transition-all duration-200"
            onClick={() => setIsCollapsed(!isCollapsed)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d={isCollapsed ? "M9 18l6-6-6-6" : "M15 18l-6-6 6-6"}/>
            </svg>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 font-open-sans">
          <div className="mb-4">
            {!isCollapsed && (
              <div className="text-white/40 text-xs font-medium mb-3 px-4">TOOLS</div>
            )}
          </div>
          <ul className="space-y-2">
            {navigationItems.map((item) => (
              <li key={item.id}>
                <button
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left rounded-lg transition-all duration-200 ${
                    activeTab === item.id 
                      ? 'text-white bg-white/10' 
                      : 'text-white/80 hover:text-white hover:bg-white/5'
                  }`}
                  onClick={() => handleTabChange(item.id)}
                >
                  <span className="text-white/60">{item.icon}</span>
                  {!isCollapsed && <span className="font-medium">{item.label}</span>}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Wallet Connection */}
        <div className="mt-auto">
          {isConnected ? (
            <div className="bg-black/30 backdrop-blur-xl rounded-xl p-4 border border-white/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                  {!isCollapsed && (
                    <div>
                      <div className="text-white text-sm font-medium">{formatAddress(account)}</div>
                      <div className="text-white/40 text-xs">{getNetworkName(chainId)}</div>
                    </div>
                  )}
                </div>
                {!isCollapsed && (
                  <button 
                    className="text-red-300 hover:text-red-200 p-2 rounded-lg hover:bg-red-500/20 transition-all duration-200"
                    onClick={disconnectWallet}
                    title="Disconnect"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                      <polyline points="16,17 21,12 16,7"/>
                      <line x1="21" y1="12" x2="9" y2="12"/>
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <button 
              className="w-full bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-semibold rounded-xl transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-purple-500/25 p-3 flex items-center justify-center gap-2"
              onClick={connectWallet}
            >
              {!isCollapsed ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/>
                    <path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/>
                    <line x1="18" y1="12" x2="18" y2="12"/>
                  </svg>
                  Connect Wallet
                </>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/>
                  <path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/>
                  <line x1="18" y1="12" x2="18" y2="12"/>
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
} 