'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase, UserProfile, getOrCreateProfile, updateUserProfile as updateProfile } from '@/lib/supabase';
import { isWalletInstalled, getWalletInstallLink } from '@/lib/ethereum';

type WalletContextType = {
  isConnected: boolean;
  address: string | null;
  chainId: string | null;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  userProfile: UserProfile | null;
  isNewUser: boolean;
  updateUserProfile: (name: string, profileImage?: string) => Promise<void>;
  showLoginModal: boolean;
  setShowLoginModal: (show: boolean) => void;
  dbConnectionError: boolean;
  useCredits: (amount: number) => Promise<boolean>;
  updateCredits: (amount: number) => Promise<boolean>;
};

// Define Ethereum interface to fix type errors
interface EthereumEvent {
  connect: (connectInfo: { chainId: string }) => void;
  disconnect: (error: { code: number; message: string }) => void;
  accountsChanged: (accounts: string[]) => void;
  chainChanged: (chainId: string) => void;
}

interface EthereumRequestArguments {
  method: string;
  params?: unknown[] | object;
}

interface Ethereum {
  request: (args: EthereumRequestArguments) => Promise<unknown>;
  on: <K extends keyof EthereumEvent>(event: K, callback: EthereumEvent[K]) => void;
  removeAllListeners: (event: keyof EthereumEvent) => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider = ({ children }: { children: ReactNode }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isNewUser, setIsNewUser] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [isBrowser, setIsBrowser] = useState(false);
  const [dbConnectionError, setDbConnectionError] = useState(false);

  // Set isBrowser state
  useEffect(() => {
    setIsBrowser(true);
  }, []);

  // Check for existing connection on mount
  useEffect(() => {
    const checkConnection = async () => {
      if (!isBrowser) return;
      
      try {
        // Check local storage for connection data
        const storedAddress = localStorage.getItem('walletAddress');
        if (storedAddress) {
          setIsConnected(true);
          setAddress(storedAddress);
          
          // Get current chain ID
          if (window.ethereum) {
            const chainId = await window.ethereum.request({ method: 'eth_chainId' }) as string;
            setChainId(chainId);
            console.log("Current chain ID:", chainId);
          }
          
          await fetchUserProfile(storedAddress);
        }
      } catch (error) {
        console.error("Error checking connection:", error);
      }
    };

    checkConnection();
  }, [isBrowser]);

  // Set up event listeners for wallet changes
  useEffect(() => {
    if (!isBrowser || !window.ethereum) return;

    const handleAccountsChanged = (accounts: string[]) => {
      console.log("Accounts changed:", accounts);
      if (accounts.length === 0) {
        // User disconnected their wallet
        disconnectWallet();
      } else if (accounts[0] !== address) {
        // User switched to a different account
        setAddress(accounts[0]);
        localStorage.setItem('walletAddress', accounts[0]);
        fetchUserProfile(accounts[0]);
      }
    };

    const handleChainChanged = (chainId: string) => {
      console.log("Chain changed:", chainId);
      setChainId(chainId);
      // Reload the page as recommended by MetaMask
      window.location.reload();
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    return () => {
      if (window.ethereum) {
        window.ethereum.removeAllListeners('accountsChanged');
        window.ethereum.removeAllListeners('chainChanged');
      }
    };
  }, [isBrowser, address]);

  const fetchUserProfile = async (walletAddress: string) => {
    try {
      console.log("Fetching profile for address:", walletAddress);
      setDbConnectionError(false);
      
      // Use the improved getOrCreateProfile function
      const profile = await getOrCreateProfile(walletAddress);
      
      if (!profile) {
        console.error("Could not fetch or create profile");
        // Only set database connection error if there was an actual error
        // Not when it's just a new user
        setIsNewUser(true);
        setShowLoginModal(true);
        return null;
      } else {
        console.log("Fetched profile:", profile);
        setUserProfile(profile);
        setIsNewUser(false);
        return profile;
      }
    } catch (error) {
      console.error("Error fetching profile:", error);
      // Only set database connection error for actual errors
      setDbConnectionError(true);
      return null;
    }
  };

  const connectWallet = async (): Promise<void> => {
    if (!isBrowser) return;
    
    console.log("Attempting to connect wallet");
    
    if (isWalletInstalled()) {
      try {
        console.log("Ethereum provider detected, requesting accounts");
        // Request account access
        const accounts = await window.ethereum!.request({ 
          method: 'eth_requestAccounts' 
        }) as string[];
        
        console.log("Accounts received:", accounts);
        
        const account = accounts[0];
        
        // Get current chain ID
        const chainId = await window.ethereum!.request({ 
          method: 'eth_chainId' 
        }) as string;
        
        console.log("Current chain ID:", chainId);
        
        // Update state
        setIsConnected(true);
        setAddress(account);
        setChainId(chainId);
        localStorage.setItem('walletAddress', account);
        
        // Fetch or create user profile
        const profile = await fetchUserProfile(account);
        if (!profile) {
          setShowLoginModal(true);
        }
      } catch (error) {
        console.error('Error connecting wallet:', error);
      }
    } else {
      console.log("No Ethereum provider detected");
      const installUrl = getWalletInstallLink();
      
      if (confirm('You need to install MetaMask or another Ethereum wallet to use this feature. Would you like to install MetaMask now?')) {
        window.open(installUrl, '_blank');
      }
    }
  };

  const disconnectWallet = () => {
    if (!isBrowser) return;
    
    console.log("Disconnecting wallet");
    // Clear all state
    setIsConnected(false);
    setAddress(null);
    setChainId(null);
    setUserProfile(null);
    setIsNewUser(false);
    
    // Remove from local storage
    localStorage.removeItem('walletAddress');
    
    // Force page refresh to ensure all states are reset
    window.location.reload();
  };

  const updateUserProfile = async (name: string, profileImage?: string): Promise<void> => {
    if (!address) return;

    try {
      console.log("Updating profile for address:", address);
      console.log("Profile image URL to save:", profileImage);
      
      // Use the improved updateProfile function
      const updatedProfile = await updateProfile(
        address,
        name,
        profileImage
      );
      
      if (!updatedProfile) {
        console.error("Failed to update profile");
        alert('Failed to save profile. Please try again.');
        return;
      }
      
      console.log("Profile updated successfully:", updatedProfile);
      setUserProfile(updatedProfile);
      setIsNewUser(false);
      setShowLoginModal(false);
    } catch (error) {
      console.error("Error updating profile:", error);
      alert('An unexpected error occurred. Please try again.');
    }
  };

  // New function to use (deduct) credits
  const useCredits = async (amount: number): Promise<boolean> => {
    if (!address || !userProfile) return false;
    
    // Check if user has enough credits
    if (userProfile.credits < amount) {
      alert('You don\'t have enough credits for this action.');
      return false;
    }

    try {
      // Update credits in the database
      const { data, error } = await supabase
        .from('profiles')
        .update({ credits: userProfile.credits - amount })
        .eq('wallet_address', address.toLowerCase())
        .select()
        .single();
        
      if (error) {
        console.error('Error updating credits:', error);
        alert('Failed to update credits. Please try again.');
        return false;
      }

      // Update local state
      setUserProfile(data as UserProfile);
      return true;
    } catch (error) {
      console.error("Error using credits:", error);
      return false;
    }
  };

  // New function to add credits
  const updateCredits = async (amount: number): Promise<boolean> => {
    if (!address || !userProfile) return false;

    try {
      // Update credits in the database
      const { data, error } = await supabase
        .from('profiles')
        .update({ credits: userProfile.credits + amount })
        .eq('wallet_address', address.toLowerCase())
        .select()
        .single();
        
      if (error) {
        console.error('Error updating credits:', error);
        alert('Failed to update credits. Please try again.');
        return false;
      }

      // Update local state
      setUserProfile(data as UserProfile);
      return true;
    } catch (error) {
      console.error("Error updating credits:", error);
      return false;
    }
  };

  return (
    <WalletContext.Provider
      value={{
        isConnected,
        address,
        chainId,
        connectWallet,
        disconnectWallet,
        userProfile,
        isNewUser,
        updateUserProfile,
        showLoginModal,
        setShowLoginModal,
        dbConnectionError,
        useCredits,
        updateCredits,
      }}
    >
      {children}
      {dbConnectionError && (
        <div className="fixed bottom-4 right-4 bg-red-500/80 text-white px-4 py-3 rounded-lg shadow-lg z-50">
          <div className="flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span>Database connection error. Profile data may not be saved.</span>
          </div>
        </div>
      )}
    </WalletContext.Provider>
  );
};

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};

// Add Ethereum to Window type
declare global {
  interface Window {
    ethereum?: Ethereum;
  }
} 