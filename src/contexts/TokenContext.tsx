'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

// Define interfaces based on API response
interface SecurityInfo {
  code: number;
  msg: string;
  data: {
    goplus: {
      id: number;
      chain: string;
      address: string;
      anti_whale_modifiable: number;
      buy_tax: number;
      cannot_buy: number;
      can_take_back_ownership: number;
      creator_address: string;
      creator_balance: number;
      creator_percent: number;
      external_call: number;
      hidden_owner: number;
      holder_count: number;
      honeypot_with_same_creator: number;
      is_anti_whale: number;
      is_blacklisted: number;
      is_honeypot: number;
      is_in_dex: number;
      is_mintable: number;
      is_open_source: number;
      is_proxy: number;
      is_whitelisted: number;
      owner_address: string;
      owner_balance: number;
      owner_change_balance: number;
      owner_percent: number;
      personal_slippage_modifiable: number;
      selfdestruct: number;
      sell_tax: number;
      slippage_modifiable: number;
      token_name: string;
      token_symbol: string;
      total_supply: number;
      trading_cooldown: number;
      transfer_pausable: number;
      updated_at: number;
      lp_holders: Array<{
        tag?: string;
        value: string | null;
        address: string;
        balance: string;
        percent: string;
        NFT_list: Record<string, unknown> | null;
        is_locked: number;
        is_contract: number;
      }>;
      lp_total_supply: number;
      fake_token: null | Record<string, unknown>;
      cannot_sell_all: number;
      lp_holder_count: number;
      renounced: number;
      honeypot_data: {
        token: {
          name: string;
          symbol: string;
          decimals: number;
          address: string;
          totalHolders: number;
        };
        withToken: {
          name: string;
          symbol: string;
          decimals: number;
          address: string;
          totalHolders: number;
        };
        summary: {
          risk: string;
          riskLevel: number;
          flags: string[];
        };
        simulationSuccess: boolean;
        honeypotResult: {
          isHoneypot: boolean;
        };
        simulationResult: {
          buyTax: number;
          sellTax: number;
          transferTax: number;
          buyGas: string;
          sellGas: string;
        };
        holderAnalysis: {
          holders: string;
          successful: string;
          failed: string;
          siphoned: string;
          averageTax: number;
          averageGas: number;
          highestTax: number;
          highTaxWallets: string;
          taxDistribution: Array<{
            tax: number;
            count: number;
          }>;
          snipersFailed: number;
          snipersSuccess: number;
        };
        flags: string[];
        contractCode: {
          openSource: boolean;
          rootOpenSource: boolean;
          isProxy: boolean;
          hasProxyCalls: boolean;
        };
        chain: {
          id: string;
          name: string;
          shortName: string;
          currency: string;
        };
        router: string;
        pair: {
          pair: {
            name: string;
            address: string;
            token0: string;
            token1: string;
            type: string;
          };
          chainId: string;
          reserves0: string;
          reserves1: string;
          liquidity: number;
          router: string;
          createdAtTimestamp: string;
          creationTxHash: string;
        };
        pairAddress: string;
        updated_at: number;
      };
      flags: string[];
      is_tradable: number;
      is_in_token_list: number;
      is_low_liq: number;
      launched: null | Record<string, unknown>;
      rugged: null | Record<string, unknown>;
      deploys: null | Record<string, unknown>;
      lockInfo: {
        isLock: boolean;
        lockDetail: Array<{
          percent: string;
          pool: string;
          isBlackHole: boolean;
        }>;
        lockTag: string[];
        lockPercent: number;
        leftLockPercent: number;
      };
      top_10_holder_rate: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface RugAnalysis {
  data: {
    link: {
      address?: string;
      gmgn?: string;
      geckoterminal?: string;
      twitter_username?: string;
      website?: string;
      telegram?: string;
      bitbucket?: string;
      discord?: string;
      description?: string;
      facebook?: string;
      github?: string;
      instagram?: string;
      linkedin?: string;
      medium?: string;
      reddit?: string;
      tiktok?: string;
      youtube?: string;
      verify_status?: number;
      [key: string]: unknown;
    };
    rug: unknown;
    vote: {
      like: number;
      unlike: number;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface LockInfoItem {
  NFT_list: null | Record<string, unknown>;
  address: string;
  balance: string;
  is_locked: number;
  locked_detail: null | Record<string, unknown>;
  percent: string;
  tag?: string;
}

interface LockDetail {
  percent: string;
  pool: string;
  is_blackhole: boolean;
}

interface LaunchSecurity {
  data: {
    address: string;
    security: {
      address: string;
      is_show_alert: boolean;
      top_10_holder_rate: string;
      burn_ratio: string;
      burn_status: string;
      dev_token_burn_amount: string;
      dev_token_burn_ratio: string;
      is_open_source: boolean;
      open_source: number;
      is_blacklist: boolean;
      blacklist: number;
      is_honeypot: boolean;
      honeypot: number;
      is_renounced: boolean;
      renounced: number;
      can_sell: number;
      can_not_sell: number;
      buy_tax: string;
      sell_tax: string;
      average_tax: string;
      high_tax: string;
      flags: string[];
      lockInfo: LockInfoItem[];
      lock_summary: {
        is_locked: boolean;
        lock_detail: LockDetail[];
        lock_tags: string[];
        lock_percent: string;
        left_lock_percent: string;
      };
      hide_risk: boolean;
      [key: string]: unknown;
    };
    launchpad: null | Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface TokenStats {
  data: {
    holder_count: number;
    bluechip_owner_count: number;
    bluechip_owner_percentage: string;
    signal_count: number;
    degen_call_count: number;
    top_rat_trader_percentage: string;
    top_bundler_trader_percentage: string;
    top_entrapment_trader_percentage: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface Trader {
  address: string;
  profit: number;
  tags: string[];
  wallet_tag_v2: string;
  maker_token_tags: string[];
  buy_amount_cur: number;
  sell_amount_cur: number;
  last_active_timestamp?: number;
  [key: string]: unknown;
}

interface TokenRisk {
  score: number;
  level: 'High' | 'Medium' | 'Low';
  factors: {
    name: string;
    risk: 'high' | 'medium' | 'low';
    description: string;
  }[];
}

interface TokenContextType {
  address: string;
  setAddress: (address: string) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  error: string;
  setError: (error: string) => void;
  analysisComplete: boolean;
  setAnalysisComplete: (analysisComplete: boolean) => void;
  
  // API data
  securityInfo: SecurityInfo | null;
  setSecurityInfo: (securityInfo: SecurityInfo | null) => void;
  rugAnalysis: RugAnalysis | null;
  setRugAnalysis: (rugAnalysis: RugAnalysis | null) => void;
  launchSecurity: LaunchSecurity | null;
  setLaunchSecurity: (launchSecurity: LaunchSecurity | null) => void;
  tokenStats: TokenStats | null;
  setTokenStats: (tokenStats: TokenStats | null) => void;
  topTraders: Trader[];
  setTopTraders: (topTraders: Trader[]) => void;
  tokenRisk: TokenRisk | null;
  setTokenRisk: (tokenRisk: TokenRisk | null) => void;
  showAllData: boolean;
  setShowAllData: (showAllData: boolean) => void;
  
  // Helper functions
  getNumericValue: (value: unknown, defaultValue?: number) => number;
  formatAddress: (address: string) => string;
  formatPercentage: (value: unknown) => string;
  getBurnPercentage: () => string;
  getLockPercentage: () => string;
  getUniqueMakerTags: () => string[];
  activeMakerTag: string;
  setActiveMakerTag: (tag: string) => void;
}

const TokenContext = createContext<TokenContextType | undefined>(undefined);

export const TokenProvider = ({ children }: { children: ReactNode }) => {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [analysisComplete, setAnalysisComplete] = useState(false);

  // State for API data
  const [securityInfo, setSecurityInfo] = useState<SecurityInfo | null>(null);
  const [rugAnalysis, setRugAnalysis] = useState<RugAnalysis | null>(null);
  const [launchSecurity, setLaunchSecurity] = useState<LaunchSecurity | null>(null);
  const [tokenStats, setTokenStats] = useState<TokenStats | null>(null);
  const [topTraders, setTopTraders] = useState<Trader[]>([]);
  const [tokenRisk, setTokenRisk] = useState<TokenRisk | null>(null);
  const [showAllData, setShowAllData] = useState(false);
  const [activeMakerTag, setActiveMakerTag] = useState<string>('');

  // Helper functions
  const getNumericValue = (value: unknown, defaultValue: number = 0): number => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const num = parseFloat(value);
      return isNaN(num) ? defaultValue : num;
    }
    return defaultValue;
  };

  const formatAddress = (address: string): string => {
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  };

  const formatPercentage = (value: unknown): string => {
    if (value === undefined || value === null) return 'N/A';
    if (typeof value === 'number') return `${value.toFixed(2)}%`;
    if (typeof value === 'string') {
      const num = parseFloat(value);
      return isNaN(num) ? 'N/A' : `${num.toFixed(2)}%`;
    }
    return 'N/A';
  };

  const getBurnPercentage = (): string => {
    if (launchSecurity?.data?.security?.burn_ratio) {
      const value = getNumericValue(launchSecurity.data.security.burn_ratio);
      return `${value * 100}%`;
    }
    return 'N/A';
  };

  const getLockPercentage = (): string => {
    if (securityInfo?.data?.goplus?.lockInfo?.lockPercent) {
      return `${securityInfo.data.goplus.lockInfo.lockPercent * 100}%`;
    }
    if (launchSecurity?.data?.security?.lock_summary?.lock_percent) {
      return `${getNumericValue(launchSecurity.data.security.lock_summary.lock_percent) * 100}%`;
    }
    return 'N/A';
  };

  const getUniqueMakerTags = (): string[] => {
    const allTags: string[] = [];
    
    topTraders.forEach(trader => {
      if (trader.maker_token_tags && Array.isArray(trader.maker_token_tags)) {
        trader.maker_token_tags.forEach(tag => {
          if (!allTags.includes(tag)) {
            allTags.push(tag);
          }
        });
      }
    });
    return allTags;
  };

  return (
    <TokenContext.Provider value={{
      address,
      setAddress,
      loading,
      setLoading,
      error,
      setError,
      analysisComplete,
      setAnalysisComplete,
      securityInfo,
      setSecurityInfo,
      rugAnalysis,
      setRugAnalysis,
      launchSecurity,
      setLaunchSecurity,
      tokenStats,
      setTokenStats,
      topTraders,
      setTopTraders,
      tokenRisk,
      setTokenRisk,
      showAllData,
      setShowAllData,
      getNumericValue,
      formatAddress,
      formatPercentage,
      getBurnPercentage,
      getLockPercentage,
      getUniqueMakerTags,
      activeMakerTag,
      setActiveMakerTag
    }}>
      {children}
    </TokenContext.Provider>
  );
};

export const useToken = () => {
  const context = useContext(TokenContext);
  if (context === undefined) {
    throw new Error('useToken must be used within a TokenProvider');
  }
  return context;
};

export type { SecurityInfo, RugAnalysis, LaunchSecurity, TokenStats, Trader, TokenRisk }; 