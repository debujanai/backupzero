// File: src/app/api/audit/route.ts
import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import * as solParser from '@solidity-parser/parser';

// Define ParseResult type alias
type ParseResult = ReturnType<typeof solParser.parse>;

// Initialize provider (using Infura, but could be configured for other providers)
const provider = new ethers.JsonRpcProvider(
  process.env.ETHEREUM_RPC_URL || ''
);

// Etherscan API key for fetching verified contract source code
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || '';

// Interface for vulnerability report
interface SecurityIssue {
  title: string;
  description: string;
  impact?: string;
  confidence?: string;
}

// Interface for audit response
interface AuditResponse {
  contractAddress: string;
  contractName: string;
  compiler: string;
  securityAnalysis: {
    issues: SecurityIssue[];
  };
}

// Define Vulnerability interface at the top of the file
interface Vulnerability {
  name: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | 'Informational';
  codeSnippet: string;
  explanation: string;
  impact: string;
  recommendation: string;
}

// Main API handler function
export async function POST(request: Request) {
  try {
    const { address } = await request.json();

    // Validate contract address
    if (!address || !ethers.isAddress(address)) {
      return NextResponse.json({ error: 'Invalid Ethereum contract address' }, { status: 400 });
    }

    try {
      // Fetch contract source code from Etherscan
      const contractData = await fetchContractSource(address);
      
      if (!contractData) {
        return NextResponse.json({ error: 'Contract source code not found or not verified on Etherscan' }, { status: 404 });
      }

      try {
        // Perform comprehensive security audit
        const vulnerabilities = await auditContract(contractData.sourceCode, address);

        // Prepare response
        const response: AuditResponse = {
          contractAddress: address,
          contractName: contractData.contractName,
          compiler: contractData.compiler,
          securityAnalysis: {
            issues: vulnerabilities.map(v => ({
              title: v.name,
              description: `${v.explanation}\n\nImpact: ${v.impact}\n\nRecommendation: ${v.recommendation}`,
              impact: v.severity,
              confidence: 'High'
            }))
          }
        };

        return NextResponse.json(response);
      } catch (auditError) {
        console.error('Error during contract audit analysis:', auditError);
        return NextResponse.json({ 
          error: 'Error analyzing contract',
          details: auditError instanceof Error ? auditError.message : 'Unknown error during contract analysis'
        }, { status: 422 });
      }
    } catch (sourceError) {
      console.error('Error fetching or parsing contract source:', sourceError);
      
      // Provide more specific error messages based on the error type
      let errorMessage = 'Error processing contract source code';
      let errorDetails = sourceError instanceof Error ? sourceError.message : 'Unknown error';
      
      if (errorDetails.includes('JSON')) {
        errorMessage = 'Error parsing contract source format';
        errorDetails = 'The contract source code is in a format that could not be processed. It may use a non-standard format or encoding.';
      } else if (errorDetails.includes('valid Solidity')) {
        errorMessage = 'Invalid Solidity code';
        errorDetails = 'The contract source does not appear to be valid Solidity code. Please verify the contract address.';
      }
      
      return NextResponse.json({ 
        error: errorMessage,
        details: errorDetails
      }, { status: 422 });
    }
  } catch (error) {
    console.error('Error in audit API:', error);
    return NextResponse.json({ 
      error: 'Error processing contract audit request',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// Function to fetch contract source code from Etherscan
async function fetchContractSource(contractAddress: string): Promise<{
  sourceCode: string;
  contractName: string;
  compiler: string;
} | null> {
  try {
    const etherscanUrl = `https://api.etherscan.io/api?module=contract&action=getsourcecode&address=${contractAddress}&apikey=${ETHERSCAN_API_KEY}`;
    
    const response = await fetch(etherscanUrl);
    const data = await response.json();
    
    if (data.status !== '1' || !data.result || data.result.length === 0) {
      return null;
    }

    const sourceCode = data.result[0].SourceCode;
    
    // If source code is empty, return null
    if (!sourceCode || sourceCode.trim() === '') {
      return null;
    }

    // Handle different Etherscan source code formats
    let parsedSourceCode = sourceCode;
    
    // Extract Solidity code using regex patterns if it's JSON-encoded
    if (sourceCode.startsWith('{') && sourceCode.endsWith('}')) {
      // Try to find Solidity code patterns in the source
      const solidityPatterns = [
        // Look for pragma solidity statement
        /pragma\s+solidity\s+[\^<>=0-9.]+;/,
        // Look for contract definition
        /contract\s+[a-zA-Z0-9_]+\s*{/,
        // Look for interface definition
        /interface\s+[a-zA-Z0-9_]+\s*{/,
        // Look for library definition
        /library\s+[a-zA-Z0-9_]+\s*{/
      ];

      // First try to parse the JSON properly
      try {
        let parsed;
        
        // For double-encoded JSON format
        if (sourceCode.includes('\\"')) {
          // Try to fix common JSON parsing issues
          const cleanedSource = sourceCode
            .replace(/\\"/g, '"')  // Replace escaped quotes
            .replace(/\\/g, '\\\\') // Properly escape backslashes
            .replace(/\n/g, '\\n') // Escape newlines
            .replace(/\r/g, '\\r') // Escape carriage returns
            .replace(/\t/g, '\\t'); // Escape tabs
          
          try {
            parsed = JSON.parse(cleanedSource);
          } catch (e) {
            // If that fails, try to extract the JSON by removing outer quotes
            const innerJson = sourceCode.substring(1, sourceCode.length - 1);
            parsed = JSON.parse(innerJson);
          }
          
          // Handle standard-json-input format
          if (parsed && parsed.sources) {
            const mainSource = Object.values(parsed.sources)[0] as any;
            parsedSourceCode = mainSource.content;
          } else if (parsed) {
            parsedSourceCode = Object.values(parsed)[0] as string;
          }
        } 
        // For single-encoded JSON format (flattened multi-part files)
        else {
          try {
            parsed = JSON.parse(sourceCode);
          } catch (e) {
            // If parsing fails, try to extract the content using regex
            for (const pattern of solidityPatterns) {
              const match = sourceCode.match(pattern);
              if (match) {
                // Found Solidity code, extract from this point onwards
                const startIndex = sourceCode.indexOf(match[0]);
                parsedSourceCode = sourceCode.substring(startIndex);
                break;
              }
            }
          }
          
          if (parsed && typeof parsed === 'object' && parsed !== null) {
            // Extract the main contract - typically the last one or the one with the matching name
            const mainSource = Object.values(parsed).find(
              (src: any) => typeof src === 'string' && src.includes('contract')
            );
            if (mainSource) {
              parsedSourceCode = mainSource as string;
            }
          }
        }
      } catch (e) {
        console.warn('Failed to parse JSON-encoded source code:', e);
        
        // If JSON parsing fails, try to extract Solidity code using regex
        for (const pattern of solidityPatterns) {
          const match = sourceCode.match(pattern);
          if (match) {
            // Found Solidity code, extract from this point onwards
            const startIndex = sourceCode.indexOf(match[0]);
            parsedSourceCode = sourceCode.substring(startIndex);
            break;
          }
        }
        
        // If we still couldn't extract valid Solidity code, throw an error
        if (parsedSourceCode === sourceCode && !parsedSourceCode.includes('pragma solidity') && !parsedSourceCode.includes('contract ')) {
          throw new Error('Failed to extract valid Solidity code from the contract source. The contract may be in an unsupported format.');
        }
      }
    }

    // Verify that the parsed source code looks like valid Solidity code
    if (!parsedSourceCode.includes('pragma solidity') && !parsedSourceCode.includes('contract ')) {
      throw new Error('The source code does not appear to be valid Solidity code. It may be in an unsupported format.');
    }

    return {
      sourceCode: parsedSourceCode,
      contractName: data.result[0].ContractName,
      compiler: data.result[0].CompilerVersion
    };
  } catch (error) {
    console.error('Error fetching contract source:', error);
    throw error;
  }
}

// Main function to audit a smart contract
async function auditContract(sourceCode: string, contractAddress: string): Promise<Vulnerability[]> {
  const vulnerabilities: Vulnerability[] = [];
  
  try {
    // Get contract bytecode and EVM details
    const contractBytecode = await provider.getCode(contractAddress);
    
    // Verify that the source code is valid Solidity code before parsing
    if (!sourceCode.includes('pragma solidity') && !sourceCode.includes('contract ')) {
      throw new Error('Invalid Solidity source code. The contract may be in an unsupported format.');
    }

    try {
      // Parse the Solidity source code to AST for static analysis
      const ast = solParser.parse(sourceCode, { loc: true, range: true });
      
      // Run all vulnerability checks
      vulnerabilities.push(...detectRugPullRisks(sourceCode, ast));
      vulnerabilities.push(...detectMintingIssues(sourceCode, ast));
      vulnerabilities.push(...detectHoneypotPatterns(sourceCode, ast));
      vulnerabilities.push(...detectAccessControlIssues(sourceCode, ast));
      vulnerabilities.push(...detectReentrancyVulnerabilities(sourceCode, ast));
      vulnerabilities.push(...detectIntegerOverflows(sourceCode, ast));
      vulnerabilities.push(...detectUncheckedExternalCalls(sourceCode, ast));
      
      // Add bytecode analysis for additional insights
      vulnerabilities.push(...analyzeContractBytecode(contractBytecode, sourceCode));
      
      // Add hardcoded address checks
      vulnerabilities.push(...detectHardcodedAddresses(sourceCode, ast, contractAddress));
      
      // Add gas optimization checks
      vulnerabilities.push(...detectGasOptimizationIssues(sourceCode, ast));
      
      // Add front-running risk detection
      vulnerabilities.push(...detectFrontRunningRisks(sourceCode, ast));
      
      // Add proxy contract risk detection
      vulnerabilities.push(...detectProxyContractRisks(sourceCode, ast));
      
      // Use the refactored function if additional checks are needed
      // vulnerabilities.push(..._analyzeContractSecurity(sourceCode, ast, contractAddress));
    } catch (parseError) {
      console.error('Error parsing Solidity code:', parseError);
      throw new Error(`Failed to parse Solidity code: ${parseError instanceof Error ? parseError.message : 'Unknown parsing error'}`);
    }
    
    // Deduplicate vulnerabilities
    return deduplicateVulnerabilities(vulnerabilities);
  } catch (error) {
    console.error('Error in contract audit:', error);
    throw error;
  }
}

// Function to deduplicate vulnerabilities
function deduplicateVulnerabilities(vulnerabilities: Vulnerability[]): Vulnerability[] {
  const uniqueVulnerabilities: Vulnerability[] = [];
  const seenKeys = new Set<string>();
  
  // Sort vulnerabilities by severity to prioritize more critical issues
  const sortedVulnerabilities = [...vulnerabilities].sort((a, b) => {
    const severityOrder = { 'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3, 'Informational': 4 };
    return (severityOrder[a.severity as keyof typeof severityOrder] || 5) - 
           (severityOrder[b.severity as keyof typeof severityOrder] || 5);
  });
  
  for (const vuln of sortedVulnerabilities) {
    // Create a unique key based on vulnerability name and code snippet
    // Normalize the code snippet to avoid minor differences causing duplicates
    const normalizedCodeSnippet = vuln.codeSnippet
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 100);
    
    const key = `${vuln.name}|${normalizedCodeSnippet}`;
    
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueVulnerabilities.push(vuln);
    }
  }
  
  // Limit the number of vulnerabilities to avoid overwhelming the user
  // Prioritize by severity (already sorted)
  const maxVulnerabilities = 10;
  if (uniqueVulnerabilities.length > maxVulnerabilities) {
    return uniqueVulnerabilities.slice(0, maxVulnerabilities);
  }
  
  return uniqueVulnerabilities;
}

// Function to analyze contract bytecode for additional insights
function analyzeContractBytecode(bytecode: string, sourceCode: string): Vulnerability[] {
  const vulnerabilities: Vulnerability[] = [];
  
  // Skip if bytecode is just "0x" (not deployed or self-destructed)
  if (bytecode === '0x') {
    vulnerabilities.push({
      name: 'Contract Not Deployed or Self-Destructed',
      severity: 'Critical',
      codeSnippet: '',
      explanation: 'The contract is either not deployed or has been self-destructed.',
      impact: 'All contract functionality is unavailable.',
      recommendation: 'Verify the contract address and deployment status.'
    });
    return vulnerabilities;
  }
  
  // Check for small contract bytecode which might indicate proxy patterns
  if (bytecode.length < 1000 && !sourceCode.includes('selfdestruct')) {
    vulnerabilities.push({
      name: 'Possible Proxy Contract',
      severity: 'Informational',
      codeSnippet: sourceCode.substring(0, 200) + '...',
      explanation: 'This contract has minimal bytecode and may be a proxy to another implementation contract.',
      impact: 'Actual implementation logic may be located in another contract.',
      recommendation: 'Analyze the implementation contract for a complete security assessment.'
    });
  }
  
  // Check for assembly usage in bytecode (not always detectable from source)
  if (bytecode.includes('39509556') && !sourceCode.includes('assembly')) {
    vulnerabilities.push({
      name: 'Hidden Assembly Code',
      severity: 'High',
      codeSnippet: '',
      explanation: 'The contract bytecode contains assembly operations not evident in the source code.',
      impact: 'Potential for hidden functionality not visible in source code review.',
      recommendation: 'Verify all source code has been provided and check for obfuscated logic.'
    });
  }
  
  return vulnerabilities;
}

// 1. Detect Rug Pull Risks
function detectRugPullRisks(sourceCode: string, ast: ParseResult): Vulnerability[] {
  const vulnerabilities: Vulnerability[] = [];
  
  // Helper function to check if a pattern exists in a risky context
  const isInRiskyContext = (pattern: string | RegExp, safeContexts: (string | RegExp)[]): boolean => {
    if (typeof pattern === 'string') {
      if (!sourceCode.includes(pattern)) return false;
    } else {
      if (!pattern.test(sourceCode)) return false;
    }
    
    // Check if the pattern exists in a safe context
    for (const safeContext of safeContexts) {
      if (typeof safeContext === 'string') {
        if (sourceCode.includes(safeContext)) return false;
      } else {
        if (safeContext.test(sourceCode)) return false;
      }
    }
    
    return true;
  };

  // Check for ownership transfer risks, but exclude common safe patterns
  const hasOwnershipTransfer = isInRiskyContext(
    /(transferOwnership|newOwner|owner\s*=\s*_[a-zA-Z0-9]+)/,
    [
      'timelock',
      'TimeLock',
      'governance',
      'Governance',
      'multisig',
      'MultiSig',
      /require\(\s*delay\s*[><=]/,
      /require\(\s*block\.timestamp\s*[><=]/,
      /onlyRole\(GOVERNANCE_ROLE\)/,
      /onlyRole\(ADMIN_ROLE\)/
    ]
  );
  
  if (hasOwnershipTransfer) {
    const codeSnippet = extractCodeSnippet(sourceCode, 
      /(function transferOwnership|function setOwner|owner\s*=\s*_[a-zA-Z0-9]+)/
    );
    
    // Check if there are safeguards around ownership transfer
    const hasSafeguards = 
      sourceCode.includes('require(newOwner != address(0)') || 
      sourceCode.includes('require(_newOwner != address(0)') ||
      /require\(\s*[_a-zA-Z0-9]+\s*!=\s*address\(0\)\s*\)/.test(sourceCode);
    
    vulnerabilities.push({
      name: 'Potential Ownership Transfer Risk',
      severity: hasSafeguards ? 'Medium' : 'High',
      codeSnippet,
      explanation: 'The contract allows ownership transfers which could enable privileged operations.' + 
                  (hasSafeguards ? ' Some basic safeguards are in place.' : ''),
      impact: 'A malicious actor who gains ownership can control critical contract functions.',
      recommendation: 'Consider using a multi-signature wallet, time-lock, or DAO for ownership management.'
    });
  }

  // Check for hidden withdrawal functions with more context
  const hasWithdrawalFunction = sourceCode.includes('onlyOwner') && 
    (sourceCode.includes('transfer(') || 
     sourceCode.includes('send(') || 
     sourceCode.includes('call{value:') ||
     sourceCode.includes('.call.value'));
  
  // Check if there are legitimate withdrawal contexts
  const hasLegitimateWithdrawalContext = 
    sourceCode.includes('emergency') || 
    sourceCode.includes('rescue') || 
    sourceCode.includes('recover') ||
    sourceCode.includes('fee') ||
    sourceCode.includes('withdraw');
  
  if (hasWithdrawalFunction && !hasLegitimateWithdrawalContext) {
    // Look for functions that can withdraw funds but don't have clear naming
    const suspiciousWithdrawalPattern = /function\s+([a-zA-Z0-9_]+)\s*\(\s*\)\s*(external|public)\s+onlyOwner[\s\S]{1,500}(transfer\(|send\(|call{value:|\.call\.value\()/;
    const match = sourceCode.match(suspiciousWithdrawalPattern);
    
    if (match && !['withdraw', 'rescue', 'emergencyWithdraw', 'recoverEth', 'claimFees'].includes(match[1])) {
      const codeSnippet = extractCodeSnippet(sourceCode, suspiciousWithdrawalPattern);
      
      vulnerabilities.push({
        name: 'Potential Hidden Withdrawal Function',
        severity: 'High',
        codeSnippet,
        explanation: 'The contract contains owner-only functions that can withdraw funds with non-standard naming.',
        impact: 'The owner can potentially drain contract funds unexpectedly.',
        recommendation: 'Use clear function naming for withdrawal capabilities and implement time-locks or limits.'
      });
    }
  }

  // Check for liquidity removal risks with more context
  const hasLiquidityRemoval = 
    sourceCode.includes('removeLiquidity') || 
    sourceCode.includes('removeLiquidityETH') ||
    /remove[A-Z][a-zA-Z0-9]*Liquidity/.test(sourceCode);
  
  // Check if there are safeguards around liquidity removal
  const hasLiquiditySafeguards = 
    sourceCode.includes('lock') || 
    sourceCode.includes('Lock') || 
    sourceCode.includes('timelock') || 
    sourceCode.includes('TimeLock') ||
    /require\(\s*block\.timestamp\s*>\s*[a-zA-Z0-9_]+\s*\)/.test(sourceCode);
  
  if (hasLiquidityRemoval && !hasLiquiditySafeguards) {
    const codeSnippet = extractCodeSnippet(sourceCode, 
      /(function\s+remove[A-Za-z]*Liquidity|removeLiquidity|removeLiquidityETH)/
    );
    
    // Check if liquidity removal is restricted to privileged roles
    const isRestrictedToOwner = 
      sourceCode.includes('onlyOwner') || 
      sourceCode.includes('onlyAdmin') || 
      sourceCode.includes('onlyRole');
    
    vulnerabilities.push({
      name: isRestrictedToOwner ? 'Privileged Liquidity Removal' : 'Liquidity Removal Functionality',
      severity: isRestrictedToOwner ? 'High' : 'Medium',
      codeSnippet,
      explanation: `The contract allows removal of DEX liquidity${isRestrictedToOwner ? ', restricted to privileged roles' : ''}.`,
      impact: 'Investors could be affected if liquidity is removed unexpectedly.',
      recommendation: 'Liquidity should be locked or have a time delay with community notification.'
    });
  }

  // Check for blacklist functionality with more context
  const hasBlacklist = 
    sourceCode.includes('blacklist') || 
    sourceCode.includes('blocklist') ||
    sourceCode.includes('_blacklisted') ||
    sourceCode.includes('_blocklisted');
  
  // Check if blacklist is used in a legitimate context like anti-bot measures
  const hasLegitimateBlacklistContext = 
    sourceCode.includes('antiBot') || 
    sourceCode.includes('anti-bot') || 
    sourceCode.includes('AntiBot') ||
    sourceCode.includes('compliance') ||
    sourceCode.includes('Compliance') ||
    sourceCode.includes('sanction') ||
    sourceCode.includes('Sanction');
  
  if (hasBlacklist && !hasLegitimateBlacklistContext) {
    const codeSnippet = extractCodeSnippet(sourceCode, 
      /(blacklist|blocklist|_blacklisted|_blocklisted)/
    );
    
    vulnerabilities.push({
      name: 'Address Restriction Functionality',
      severity: 'Medium',
      codeSnippet,
      explanation: 'The contract contains functionality that can restrict specific addresses from transacting.',
      impact: 'Specific users can be prevented from selling or transferring tokens.',
      recommendation: 'Ensure blacklist functionality has clear governance controls and transparent criteria for use.'
    });
  }

  return vulnerabilities;
}

// 2. Detect Minting & Token Supply Issues
function detectMintingIssues(sourceCode: string, ast: ParseResult): Vulnerability[] {
  const vulnerabilities: Vulnerability[] = [];

  // Helper function to check if a pattern exists in a risky context
  const isInRiskyContext = (pattern: string | RegExp, safeContexts: (string | RegExp)[]): boolean => {
    if (typeof pattern === 'string') {
      if (!sourceCode.includes(pattern)) return false;
    } else {
      if (!pattern.test(sourceCode)) return false;
    }
    
    // Check if the pattern exists in a safe context
    for (const safeContext of safeContexts) {
      if (typeof safeContext === 'string') {
        if (sourceCode.includes(safeContext)) return false;
      } else {
        if (safeContext.test(sourceCode)) return false;
      }
    }
    
    return true;
  };

  // Check for mint freezing with context
  const hasMintFreezing = isInRiskyContext(
    /(mintingFinished|mint.*Enabled\s*=\s*false|mint.*Enabled\s*==\s*true)/,
    [
      'initialSupply',
      'INITIAL_SUPPLY',
      'MAX_SUPPLY',
      'maxSupply',
      /cap\s*=\s*[0-9]+/,
      /CAP\s*=\s*[0-9]+/
    ]
  );
  
  if (hasMintFreezing) {
    const codeSnippet = extractCodeSnippet(sourceCode, 
      /(mintingFinished|mint.*Enabled\s*=\s*false|mint.*Enabled\s*==\s*true)/
    );
    
    vulnerabilities.push({
      name: 'Mint Control Mechanism',
      severity: 'Medium',
      codeSnippet,
      explanation: 'The contract allows minting to be disabled.',
      impact: 'If minting is disabled before all tokens are minted, it may prevent proper distribution.',
      recommendation: 'Ensure minting cannot be disabled until all planned distribution is complete.'
    });
  }

  // Check for unlimited minting with better context
  const hasMintFunction = /function\s+mint/.test(sourceCode);
  const hasSupplyCap = /(maxSupply|MAX_SUPPLY|totalSupply\s*\+\s*amount\s*<=|cap\s*=|CAP\s*=)/.test(sourceCode);
  
  if (hasMintFunction && !hasSupplyCap) {
    // Check if mint function has access controls
    const mintFunctionWithAccessControl = /function\s+mint[^{]*{[^}]*(require|onlyOwner|onlyMinter|onlyRole)/i.test(sourceCode);
    
    const codeSnippet = extractCodeSnippet(sourceCode, /function\s+mint/);
    
    vulnerabilities.push({
      name: mintFunctionWithAccessControl ? 'Uncapped Minting with Access Controls' : 'Unlimited Minting Risk',
      severity: mintFunctionWithAccessControl ? 'Medium' : 'Critical',
      codeSnippet,
      explanation: 'The contract allows token minting without a maximum supply cap.' + 
                  (mintFunctionWithAccessControl ? ' However, minting is restricted to privileged roles.' : ''),
      impact: mintFunctionWithAccessControl 
        ? 'Privileged roles can mint tokens beyond expected supply, potentially causing inflation.'
        : 'The owner can mint infinite tokens, causing severe inflation and devaluing existing tokens.',
      recommendation: 'Implement a maximum supply cap that cannot be exceeded.'
    });
  }

  // Check for supply manipulation with better context
  const hasDirectSupplyManipulation = 
    /totalSupply\s*=/.test(sourceCode) || 
    /totalSupply\s*\+=/.test(sourceCode) || 
    /totalSupply\s*\-=/.test(sourceCode);
  
  // Check if supply manipulation is in a legitimate context
  const isInLegitimateContext = 
    sourceCode.includes('constructor') || 
    sourceCode.includes('initialize') ||
    /function\s+mint/.test(sourceCode) ||
    /function\s+burn/.test(sourceCode);
  
  if (hasDirectSupplyManipulation && !isInLegitimateContext) {
    const codeSnippet = extractCodeSnippet(sourceCode, 
      /(totalSupply\s*=|totalSupply\s*\+=|totalSupply\s*\-=)/
    );
    
    vulnerabilities.push({
      name: 'Direct Supply Manipulation',
      severity: 'High',
      codeSnippet,
      explanation: 'The contract allows direct manipulation of the total supply variable outside of standard mint/burn functions.',
      impact: 'The token supply can be changed arbitrarily, potentially causing inflation or deflation attacks.',
      recommendation: 'Total supply should only change through minting and burning functions with proper controls.'
    });
  }

  // Check for excessive burn/mint privileged functions with better context
  const privilegedFunctions = (sourceCode.match(/function\s+[a-zA-Z0-9_]+\s*\([^)]*\)\s*(external|public)\s+onlyOwner/g) || []);
  const burnMintFunctions = privilegedFunctions.filter(func => 
    func.includes('mint') || func.includes('burn') || func.includes('Mint') || func.includes('Burn')
  );
  
  // Filter out standard functions that are expected
  const nonStandardFunctions = burnMintFunctions.filter(func => 
    !func.includes('function mint') && 
    !func.includes('function burn') && 
    !func.includes('function mintTo') && 
    !func.includes('function burnFrom')
  );
  
  if (nonStandardFunctions.length > 2) {
    vulnerabilities.push({
      name: 'Multiple Supply-Altering Functions',
      severity: 'Medium',
      codeSnippet: nonStandardFunctions.slice(0, 3).join('\n...\n'),
      explanation: `The contract contains ${nonStandardFunctions.length} different privileged mint/burn functions beyond standard ones.`,
      impact: 'Multiple ways to alter token supply increases the attack surface and audit complexity.',
      recommendation: 'Simplify and consolidate supply-altering functions to reduce risk.'
    });
  }

  return vulnerabilities;
}

// 3. Detect Honeypot Patterns
function detectHoneypotPatterns(sourceCode: string, ast: ParseResult): Vulnerability[] {
  const vulnerabilities: Vulnerability[] = [];

  // Helper function to check if a pattern exists in a risky context
  const isInRiskyContext = (pattern: string | RegExp, safeContexts: (string | RegExp)[]): boolean => {
    if (typeof pattern === 'string') {
      if (!sourceCode.includes(pattern)) return false;
    } else {
      if (!pattern.test(sourceCode)) return false;
    }
    
    // Check if the pattern exists in a safe context
    for (const safeContext of safeContexts) {
      if (typeof safeContext === 'string') {
        if (sourceCode.includes(safeContext)) return false;
      } else {
        if (safeContext.test(sourceCode)) return false;
      }
    }
    
    return true;
  };

  // Check for trading restrictions with better context
  const hasTradingRestrictions = isInRiskyContext(
    /(canTrade|tradingEnabled|trading[A-Z][a-zA-Z0-9]*Enabled)/,
    [
      'launchTime',
      'startTime',
      'LAUNCH_TIME',
      'START_TIME',
      /block\.timestamp\s*[<>]=?\s*[a-zA-Z0-9_]+/,
      'tradingEnabledForever'
    ]
  );
  
  if (hasTradingRestrictions) {
    const codeSnippet = extractCodeSnippet(sourceCode, 
      /(canTrade|tradingEnabled|trading[A-Z][a-zA-Z0-9]*Enabled)/
    );
    
    // Check if trading restrictions have a time limit
    const hasTimeLimit = 
      /tradingEnabled\s*=\s*true\s*;/.test(sourceCode) || 
      /setTimeout/.test(sourceCode) ||
      /after\s*\(\s*[0-9]+\s*\)/.test(sourceCode);
    
    vulnerabilities.push({
      name: hasTimeLimit ? 'Temporary Trading Restrictions' : 'Trading Restriction Mechanism',
      severity: hasTimeLimit ? 'Medium' : 'High',
      codeSnippet,
      explanation: `The contract contains mechanisms to ${hasTimeLimit ? 'temporarily ' : ''}enable/disable trading.`,
      impact: hasTimeLimit 
        ? 'Users may be unable to sell tokens during an initial period, which could be legitimate for launch mechanics.'
        : 'Users may be unable to sell tokens if trading is disabled by the owner.',
      recommendation: hasTimeLimit 
        ? 'Ensure trading restrictions have a reasonable time limit and cannot be extended arbitrarily.'
        : 'Remove trading restriction mechanisms or add time-locks with proper governance.'
    });
  }

  // Check for excessive buy/sell tax with better context
  const taxMatches = sourceCode.match(/(\w+)(Fee|Tax)\s*=\s*(\d+)/g) || [];
  let highestTax = 0;
  let highestTaxMatch = '';
  
  for (const match of taxMatches) {
    const taxValue = parseInt(match.split('=')[1].trim());
    if (taxValue > highestTax) {
      highestTax = taxValue;
      highestTaxMatch = match;
    }
  }
  
  // Check if there are legitimate tax contexts
  const hasLegitimateContext = 
    sourceCode.includes('liquidity') || 
    sourceCode.includes('marketing') ||
    sourceCode.includes('charity') ||
    sourceCode.includes('development') ||
    sourceCode.includes('ecosystem');
  
  if (highestTax > 0) {
    let severity: 'Critical' | 'High' | 'Medium' | 'Low' | 'Informational' = 'Informational';
    let name = 'Transaction Fee Mechanism';
    
    if (highestTax > 20) {
      severity = hasLegitimateContext ? 'High' : 'Critical';
      name = 'Excessive Transaction Fee';
    } else if (highestTax > 10) {
      severity = 'Medium';
      name = 'High Transaction Fee';
    }
    
    if (highestTax > 5) {
      vulnerabilities.push({
        name,
        severity,
        codeSnippet: extractCodeSnippet(sourceCode, highestTaxMatch),
        explanation: `The contract implements a ${highestTax > 20 ? 'very high' : highestTax > 10 ? 'high' : 'moderate'} transaction fee (${highestTax}%).`,
        impact: highestTax > 20 
          ? 'Users will lose a significant portion of their funds when making transactions, potentially creating a honeypot.'
          : 'Users will pay fees on transactions, which may be used for legitimate purposes like liquidity, marketing, etc.',
        recommendation: highestTax > 20 
          ? 'Reduce transaction fee to a reasonable level (typically under 10%).'
          : 'Ensure fee distribution is transparent and serves a legitimate purpose.'
      });
    }
  }

  // Check for transfer whitelist with better context
  const hasTransferWhitelist = 
    (sourceCode.includes('whitelist') || sourceCode.includes('whitelisted')) && 
    (sourceCode.includes('transfer') || sourceCode.includes('Transfer'));
  
  // Check if whitelist is temporary or for a legitimate purpose
  const hasLegitimateWhitelistContext = 
    sourceCode.includes('presale') || 
    sourceCode.includes('preSale') ||
    sourceCode.includes('ICO') ||
    sourceCode.includes('initialOffering') ||
    sourceCode.includes('launch') ||
    sourceCode.includes('antiBot');
  
  if (hasTransferWhitelist) {
    const transferFunc = extractCodeSnippet(sourceCode, 
      /function\s+(transfer|transferFrom)[\s\S]{0,1000}require\([^)]*whitelist/
    );
    
    if (transferFunc) {
      vulnerabilities.push({
        name: hasLegitimateWhitelistContext ? 'Transfer Whitelist Mechanism' : 'Restrictive Transfer Whitelist',
        severity: hasLegitimateWhitelistContext ? 'Medium' : 'High',
        codeSnippet: transferFunc,
        explanation: `The contract restricts token transfers to whitelisted addresses only${hasLegitimateWhitelistContext ? ', which may be for a legitimate purpose like presale or launch protection' : ''}.`,
        impact: hasLegitimateWhitelistContext 
          ? 'Some users may be unable to transfer tokens during specific periods, which could be legitimate for launch mechanics.'
          : 'Regular users may be unable to sell tokens if they are not whitelisted.',
        recommendation: hasLegitimateWhitelistContext 
          ? 'Ensure whitelist restrictions have a clear purpose and timeline for removal.'
          : 'Remove transfer whitelist or ensure all legitimate users are automatically whitelisted.'
      });
    }
  }

  // Check for suspicious conditional blocks in transfer functions with better context
  const hasOwnerSpecialRules = 
    /function\s+(transfer|transferFrom)[\s\S]{0,500}if\s*\(\s*[^)]*==\s*owner/.test(sourceCode) ||
    /function\s+(transfer|transferFrom)[\s\S]{0,500}if\s*\(\s*[^)]*!=\s*owner/.test(sourceCode);
  
  // Check if special rules are for legitimate purposes
  const hasLegitimateSpecialRules = 
    sourceCode.includes('fee') && sourceCode.includes('exclude') ||
    sourceCode.includes('tax') && sourceCode.includes('exempt');
  
  if (hasOwnerSpecialRules) {
    const codeSnippet = extractCodeSnippet(sourceCode, 
      /function\s+(transfer|transferFrom)[\s\S]{0,500}if\s*\(\s*[^)]*[=!]=\s*owner/
    );
    
    vulnerabilities.push({
      name: hasLegitimateSpecialRules ? 'Special Transfer Rules for Privileged Addresses' : 'Owner-Based Transfer Rules',
      severity: hasLegitimateSpecialRules ? 'Medium' : 'High',
      codeSnippet,
      explanation: `The transfer functions have special rules for the owner or specific addresses${hasLegitimateSpecialRules ? ', which may be for fee exemptions' : ''}.`,
      impact: hasLegitimateSpecialRules 
        ? 'Different transfer rules for privileged addresses could create unfair advantages but may be legitimate for certain use cases.'
        : 'Different transfer rules may create a honeypot where only privileged addresses can sell.',
      recommendation: hasLegitimateSpecialRules 
        ? 'Ensure special rules are transparent and serve a legitimate purpose.'
        : 'Ensure transfer rules are consistent for all users.'
    });
  }

  // Check for anti-bot mechanisms with better context
  const hasAntiBot = 
    sourceCode.includes('antiBot') || 
    sourceCode.includes('anti-bot') ||
    sourceCode.includes('antiBotEnabled');
  
  // Check if anti-bot has a time limit
  const hasAntiBotTimeLimit = 
    /antiBot.*=\s*false/.test(sourceCode) || 
    /setTimeout/.test(sourceCode) ||
    /block\.timestamp\s*[<>]=?\s*[a-zA-Z0-9_]+/.test(sourceCode);
  
  if (hasAntiBot) {
    const codeSnippet = extractCodeSnippet(sourceCode, 
      /(antiBot|anti-bot|antiBotEnabled)/
    );
    
    vulnerabilities.push({
      name: hasAntiBotTimeLimit ? 'Temporary Anti-Bot Mechanism' : 'Anti-Bot Mechanism',
      severity: hasAntiBotTimeLimit ? 'Low' : 'Medium',
      codeSnippet,
      explanation: `The contract contains anti-bot mechanisms${hasAntiBotTimeLimit ? ' with time limitations' : ''}.`,
      impact: hasAntiBotTimeLimit 
        ? 'Anti-bot measures are temporary and likely used to protect the token launch from front-running bots.'
        : 'Anti-bot measures could potentially be misused to prevent legitimate users from selling tokens.',
      recommendation: hasAntiBotTimeLimit 
        ? 'Ensure anti-bot measures have a reasonable time limit and clear criteria.'
        : 'Review anti-bot implementation for potential abuse and ensure it has a sunset clause.'
    });
  }

  return vulnerabilities;
}

// 4. Detect Access Control & Privilege Escalation
function detectAccessControlIssues(sourceCode: string, ast: ParseResult): Vulnerability[] {
  const vulnerabilities: Vulnerability[] = [];

  // Helper function to check if a pattern exists in a risky context
  const isInRiskyContext = (pattern: string | RegExp, safeContexts: (string | RegExp)[]): boolean => {
    if (typeof pattern === 'string') {
      if (!sourceCode.includes(pattern)) return false;
    } else {
      if (!pattern.test(sourceCode)) return false;
    }
    
    // Check if the pattern exists in a safe context
    for (const safeContext of safeContexts) {
      if (typeof safeContext === 'string') {
        if (sourceCode.includes(safeContext)) return false;
      } else {
        if (safeContext.test(sourceCode)) return false;
      }
    }
    
    return true;
  };

  // Check for tx.origin usage with better context
  if (sourceCode.includes('tx.origin')) {
    // Check if tx.origin is used for authentication or in a risky way
    const txOriginForAuth = /require\s*\(\s*tx\.origin\s*==/.test(sourceCode) || 
                           /if\s*\(\s*tx\.origin\s*==/.test(sourceCode) ||
                           /tx\.origin\s*==\s*owner/.test(sourceCode);
    
    // Check if tx.origin is used in a safer context
    const txOriginSafeUsage = sourceCode.includes('block.coinbase') || // MEV protection
                             sourceCode.includes('frontrun');
    
    if (txOriginForAuth && !txOriginSafeUsage) {
      const codeSnippet = extractCodeSnippet(sourceCode, /tx\.origin/);
      
      vulnerabilities.push({
        name: 'Unsafe Authentication Pattern: tx.origin',
        severity: 'High',
        codeSnippet,
        explanation: 'The contract uses tx.origin for authentication instead of msg.sender.',
        impact: 'Vulnerable to phishing attacks where a user calls a malicious contract that then calls this contract.',
        recommendation: 'Use msg.sender instead of tx.origin for authentication.'
      });
    } else if (!txOriginSafeUsage) {
      const codeSnippet = extractCodeSnippet(sourceCode, /tx\.origin/);
      
      vulnerabilities.push({
        name: 'tx.origin Usage',
        severity: 'Medium',
        codeSnippet,
        explanation: 'The contract uses tx.origin which can be problematic in certain contexts.',
        impact: 'Potential security issues if tx.origin is used for critical logic.',
        recommendation: 'Review tx.origin usage and consider alternatives like msg.sender where appropriate.'
      });
    }
  }

  // Check for unprotected selfdestruct with better context
  if (sourceCode.includes('selfdestruct') || sourceCode.includes('suicide(')) {
    const selfDestructFunc = extractCodeSnippet(sourceCode, 
      /function\s+[a-zA-Z0-9_]+\s*\([^)]*\)\s*(external|public)[^{]*{\s*[^}]*selfdestruct/
    );
    
    // Check for any access controls
    const hasAccessControl = 
      selfDestructFunc && (
        selfDestructFunc.includes('onlyOwner') || 
        selfDestructFunc.includes('require(') || 
        selfDestructFunc.includes('modifier') ||
        selfDestructFunc.includes('onlyRole')
      );
    
    // Check for time-locks or governance
    const hasTimelock = 
      selfDestructFunc && (
        selfDestructFunc.includes('timelock') || 
        selfDestructFunc.includes('delay') ||
        /block\.timestamp\s*>\s*[a-zA-Z0-9_]+/.test(selfDestructFunc)
      );
    
    if (selfDestructFunc && !hasAccessControl) {
      vulnerabilities.push({
        name: 'Critical Risk: Unprotected Self-Destruct',
        severity: 'Critical',
        codeSnippet: selfDestructFunc,
        explanation: 'The contract contains a selfdestruct function without access controls.',
        impact: 'Anyone can destroy the contract and withdraw its entire balance.',
        recommendation: 'Add proper access controls to selfdestruct functionality or remove it entirely.'
      });
    } else if (selfDestructFunc && hasAccessControl && !hasTimelock) {
      vulnerabilities.push({
        name: 'Self-Destruct Without Time-Lock',
        severity: 'High',
        codeSnippet: selfDestructFunc,
        explanation: 'The contract contains a selfdestruct function with basic access controls but no time-lock.',
        impact: 'Privileged roles can immediately destroy the contract without warning.',
        recommendation: 'Add a time-lock to selfdestruct functionality to allow users time to react.'
      });
    }
  }

  // Check for emergency withdraw risks with better context
  const hasEmergencyWithdraw = 
    sourceCode.includes('emergencyWithdraw') || 
    sourceCode.includes('withdrawAll') ||
    sourceCode.includes('rescueTokens');
  
  // Check for safeguards around emergency withdrawals
  const hasWithdrawSafeguards = 
    sourceCode.includes('timelock') || 
    sourceCode.includes('TimeLock') ||
    sourceCode.includes('multisig') ||
    sourceCode.includes('MultiSig') ||
    /require\(\s*[a-zA-Z0-9_]+\.length\s*>\s*[0-9]+\s*\)/.test(sourceCode); // Multiple approvals
  
  if (hasEmergencyWithdraw && !hasWithdrawSafeguards) {
    const codeSnippet = extractCodeSnippet(sourceCode, 
      /(emergencyWithdraw|withdrawAll|rescueTokens)/
    );
    
    // Check if emergency functions have access controls
    const hasAccessControl = 
      codeSnippet.includes('onlyOwner') || 
      codeSnippet.includes('onlyAdmin') ||
      codeSnippet.includes('onlyRole');
    
    vulnerabilities.push({
      name: hasAccessControl ? 'Privileged Emergency Functions' : 'Unprotected Emergency Functions',
      severity: hasAccessControl ? 'Medium' : 'Critical',
      codeSnippet,
      explanation: `The contract contains emergency withdrawal functions${hasAccessControl ? ' restricted to privileged roles' : ' without proper access controls'}.`,
      impact: hasAccessControl 
        ? 'Privileged roles can withdraw funds from the contract without additional safeguards.'
        : 'Anyone can potentially drain funds from the contract.',
      recommendation: hasAccessControl 
        ? 'Implement time-locks and multi-signature requirements for emergency functions.'
        : 'Add proper access controls and safeguards to emergency functions.'
    });
  }

  // Check for unprotected initializers with better context
  const hasInitializer = 
    sourceCode.includes('initializer') ||
    sourceCode.includes('function initialize');
  
  // Check if this is actually an upgradeable contract
  const isUpgradeable = 
    sourceCode.includes('upgradeable') ||
    sourceCode.includes('Upgradeable') ||
    sourceCode.includes('proxy') ||
    sourceCode.includes('Proxy') ||
    sourceCode.includes('ERC1967');
  
  if (hasInitializer && isUpgradeable) {
    const initializerFunc = extractCodeSnippet(sourceCode, 
      /function\s+initialize[a-zA-Z0-9_]*\s*\([^)]*\)\s*(external|public)/
    );
    
    const isProtected = 
      initializerFunc && (
        initializerFunc.includes('initializer') || 
        initializerFunc.includes('onlyOwner') ||
        initializerFunc.includes('onlyRole') ||
        initializerFunc.includes('onlyAdmin')
      );
    
    if (initializerFunc && !isProtected) {
      vulnerabilities.push({
        name: 'Unprotected Initializer in Upgradeable Contract',
        severity: 'Critical',
        codeSnippet: initializerFunc,
        explanation: 'The contract has an initializer function without proper access controls or initializer modifier.',
        impact: 'The contract can be re-initialized by an attacker, potentially taking control of it.',
        recommendation: 'Add the "initializer" modifier or access control to all initialize functions.'
      });
    }
  } else if (hasInitializer && !isUpgradeable) {
    // If it's not clearly an upgradeable contract, lower the severity
    const initializerFunc = extractCodeSnippet(sourceCode, 
      /function\s+initialize[a-zA-Z0-9_]*\s*\([^)]*\)\s*(external|public)/
    );
    
    if (initializerFunc && !initializerFunc.includes('initializer') && !initializerFunc.includes('onlyOwner')) {
      vulnerabilities.push({
        name: 'Potentially Unprotected Initializer',
        severity: 'Medium',
        codeSnippet: initializerFunc,
        explanation: 'The contract has an initialize function that may be unprotected.',
        impact: 'If this is an upgradeable contract, it could be vulnerable to re-initialization attacks.',
        recommendation: 'If this is an upgradeable contract, add the "initializer" modifier or access control to all initialize functions.'
      });
    }
  }

  return vulnerabilities;
}

// Start from where the document was cut off
function detectReentrancyVulnerabilities(sourceCode: string, ast: ParseResult): Vulnerability[] {
    const vulnerabilities: Vulnerability[] = [];
  
    // Check for external calls before state updates
    const externalCallsBeforeStateUpdate = /(\.(transfer|send|call)\s*\([^;]*\)[^;]*;\s*[^;]*\s*=\s*[^;]*;)/g;
    const matches = sourceCode.match(externalCallsBeforeStateUpdate);
    
    if (matches) {
      vulnerabilities.push({
        name: 'Reentrancy Vulnerability: State Update After External Call',
        severity: 'Critical',
        codeSnippet: extractCodeSnippet(sourceCode, externalCallsBeforeStateUpdate),
        explanation: 'The contract updates state variables after making external calls.',
        impact: 'Vulnerable to reentrancy attacks where the external call can reenter the function before state is updated.',
        recommendation: 'Follow the checks-effects-interactions pattern: update state before making external calls.'
      });
    }
  
    // Check for missing reentrancy guard
    if (
      (sourceCode.includes('.transfer(') || 
       sourceCode.includes('.send(') || 
       sourceCode.includes('.call{value:') ||
       sourceCode.includes('.call.value(')) && 
      !sourceCode.includes('nonReentrant') &&
      !sourceCode.includes('reentrancyGuard')
    ) {
      vulnerabilities.push({
        name: 'Reentrancy Risk: Missing Reentrancy Guard',
        severity: 'High',
        codeSnippet: extractCodeSnippet(sourceCode, 
          /function\s+[a-zA-Z0-9_]+\s*\([^)]*\)\s*(external|public)[^{]*{\s*[^}]*(\.transfer\(|\.send\(|\.call{value:|\.call\.value\()/
        ),
        explanation: 'The contract makes external calls without using a reentrancy guard.',
        impact: 'May be vulnerable to reentrancy attacks if proper precautions are not taken elsewhere.',
        recommendation: 'Implement a reentrancy guard using the nonReentrant modifier from OpenZeppelin or similar.'
      });
    }
  
    // Check for cross-function reentrancy
    const externalCallFunctions = sourceCode.match(/function\s+([a-zA-Z0-9_]+)\s*\([^)]*\)\s*(external|public)[^{]*{\s*[^}]*(\.transfer\(|\.send\(|\.call{value:|\.call\.value\()/g) || [];
    const stateChangingFunctions = sourceCode.match(/function\s+([a-zA-Z0-9_]+)\s*\([^)]*\)\s*(external|public)[^{]*{\s*[^}]*(\s*=\s*)/g) || [];
    
    if (externalCallFunctions.length > 0 && stateChangingFunctions.length > 0) {
      vulnerabilities.push({
        name: 'Reentrancy Risk: Potential Cross-Function Reentrancy',
        severity: 'Medium',
        codeSnippet: externalCallFunctions[0] || 'No code snippet available',
        explanation: 'The contract contains functions with external calls and separate functions that modify state.',
        impact: 'May be vulnerable to cross-function reentrancy if an attacker can call these functions in sequence.',
        recommendation: 'Apply reentrancy guards to all functions that make external calls or modify related state.'
      });
    }
  
    return vulnerabilities;
  }
  
  // 6. Detect Integer Overflow/Underflow
  function detectIntegerOverflows(sourceCode: string, ast: ParseResult): Vulnerability[] {
    const vulnerabilities: Vulnerability[] = [];
  
    // Check for SafeMath usage
    const usingSafeMath = sourceCode.includes('using SafeMath') || 
                         sourceCode.includes('import "@openzeppelin/contracts/utils/math/SafeMath.sol"');
    
    // Check for Solidity version
    const solidityVersionMatch = sourceCode.match(/pragma\s+solidity\s+(.*?);/);
    let solidityVersion = '';
    
    if (solidityVersionMatch) {
      solidityVersion = solidityVersionMatch[1];
    }
    
    // Check if Solidity version is >= 0.8.0
    const isModernSolidity = solidityVersion.includes('0.8') || 
                            (solidityVersion.includes('^') && parseInt(solidityVersion.match(/\^(\d+\.\d+)/)?.[1] || '0') >= 0.8);
    
    // Look for arithmetic operations without SafeMath in older versions
    if (!usingSafeMath && !isModernSolidity) {
      // Check for addition, subtraction, multiplication operations
      const arithmeticOps = /([\w.]+\s*[+\-*]\s*[\w.]+)/g;
      const matches = sourceCode.match(arithmeticOps);
      
      if (matches) {
        vulnerabilities.push({
          name: 'Integer Overflow/Underflow Risk',
          severity: 'High',
          codeSnippet: extractCodeSnippet(sourceCode, arithmeticOps),
          explanation: 'The contract uses arithmetic operations without SafeMath protection in a Solidity version < 0.8.0.',
          impact: 'Vulnerable to integer overflow/underflow attacks, which can lead to unexpected behavior or fund loss.',
          recommendation: 'Use SafeMath for all arithmetic operations or upgrade to Solidity 0.8.0 or later.'
        });
      }
    }
  
    // Check for unsafe casting
    const unsafeCasts = /uint\d+\([a-zA-Z0-9_.]+\)/g;
    const castMatches = sourceCode.match(unsafeCasts);
    
    if (castMatches) {
      vulnerabilities.push({
        name: 'Integer Overflow Risk: Unsafe Type Casting',
        severity: 'Medium',
        codeSnippet: extractCodeSnippet(sourceCode, unsafeCasts),
        explanation: 'The contract performs unsafe type casting between integer types.',
        impact: 'Could lead to truncation and unexpected values if the source value exceeds the target type range.',
        recommendation: 'Use safe casting libraries like SafeCast from OpenZeppelin or add manual validation.'
      });
    }
  
    // Check for excessive use of uint8/16 which might overflow more easily
    const smallUints = /(uint8|uint16)[\s]+[a-zA-Z0-9_]+/g;
    const smallUintMatches = sourceCode.match(smallUints) || [];
    
    if (smallUintMatches.length > 5 && !isModernSolidity && !usingSafeMath) {
      vulnerabilities.push({
        name: 'Integer Overflow Risk: Excessive Use of Small Integers',
        severity: 'Low',
        codeSnippet: smallUintMatches.slice(0, 3).join('\n'),
        explanation: 'The contract uses multiple small integer types (uint8, uint16) which can overflow more easily.',
        impact: 'Increased risk of overflow in arithmetic operations involving these small integer types.',
        recommendation: 'Consider using larger integer types or ensure proper overflow protection.'
      });
    }
  
    return vulnerabilities;
  }
  
  // 7. Detect Unchecked External Calls
  function detectUncheckedExternalCalls(sourceCode: string, ast: ParseResult): Vulnerability[] {
    const vulnerabilities: Vulnerability[] = [];
  
    // Check for unchecked transfer result
    if (sourceCode.includes('.transfer(') && !sourceCode.includes('require(')) {
      const transferCalls = extractCodeSnippet(sourceCode, /[a-zA-Z0-9_]+\.transfer\([^;]*\);/);
      
      vulnerabilities.push({
        name: 'Unchecked Transfer Call',
        severity: 'Medium',
        codeSnippet: transferCalls,
        explanation: 'The contract uses .transfer() without checking the result.',
        impact: 'While .transfer() throws on failure, lack of proper error handling may cause unexpected behavior.',
        recommendation: 'Add try/catch or proper error handling around transfer calls.'
      });
    }
  
    // Check for unchecked send result
    const uncheckedSendMatches = sourceCode.match(/[a-zA-Z0-9_]+\.send\([^;]*\);(?!\s*require)/g);
    
    if (uncheckedSendMatches) {
      vulnerabilities.push({
        name: 'Unchecked Send Result',
        severity: 'High',
        codeSnippet: uncheckedSendMatches[0],
        explanation: 'The contract uses .send() without checking the boolean return value.',
        impact: 'Failed sends will not revert the transaction, potentially leaving the contract in an inconsistent state.',
        recommendation: 'Always check the return value of .send() with require() or use .transfer() instead.'
      });
    }
  
    // Check for low-level call without checking result
    const uncheckedCallMatches = sourceCode.match(/[a-zA-Z0-9_]+\.call(\{[^}]*\})?\([^;]*\);(?!\s*(require|if))/g);
    
    if (uncheckedCallMatches) {
      vulnerabilities.push({
        name: 'Unchecked Low-Level Call',
        severity: 'High',
        codeSnippet: uncheckedCallMatches[0],
        explanation: 'The contract uses low-level .call() without checking the return value.',
        impact: 'Failed calls will not revert the transaction, potentially leading to silent failures and unexpected state.',
        recommendation: 'Always check the return value of low-level calls with require() or if statements.'
      });
    }
  
    // Check for unused return values from external calls
    const externalCallsWithReturn = sourceCode.match(/([a-zA-Z0-9_]+\([^)]*\))(?!\s*(;|==|!=|>=|<=|\+=|-=|\*=|\/=))/g);
    
    if (externalCallsWithReturn && externalCallsWithReturn.length > 0) {
      vulnerabilities.push({
        name: 'Potential Unused Return Values',
        severity: 'Low',
        codeSnippet: extractCodeSnippet(sourceCode, externalCallsWithReturn[0]),
        explanation: 'The contract may have calls to functions that return values which are not used.',
        impact: 'Ignoring return values might miss critical information leading to unexpected behavior.',
        recommendation: 'Ensure all return values from function calls are properly checked and handled.'
      });
    }
  
    return vulnerabilities;
  }
  
  // 8. Detect Hardcoded Addresses
  function detectHardcodedAddresses(sourceCode: string, ast: ParseResult, contractAddress: string): Vulnerability[] {
    const vulnerabilities: Vulnerability[] = [];
  
    // Find hardcoded addresses
    const addressRegex = /0x[a-fA-F0-9]{40}/g;
    const addressMatches = sourceCode.match(addressRegex) || [];
    
    // Ignore the current contract address
    const uniqueAddresses = [...new Set(addressMatches.filter(addr => 
      addr.toLowerCase() !== contractAddress.toLowerCase()
    ))];
    
    if (uniqueAddresses.length > 0) {
      vulnerabilities.push({
        name: 'Hardcoded Ethereum Addresses',
        severity: 'Medium',
        codeSnippet: extractCodeSnippet(sourceCode, uniqueAddresses[0]),
        explanation: `The contract contains ${uniqueAddresses.length} hardcoded Ethereum addresses.`,
        impact: 'Hardcoded addresses reduce contract flexibility and may pose issues if those addresses are compromised.',
        recommendation: 'Use configurable address parameters that can be set by governance instead of hardcoding.'
      });
    }
  
    // Check for hardcoded private keys (extremely dangerous)
    const privateKeyRegex = /private\s+(key|KEY)[\s=]+["']0x[a-fA-F0-9]{64}["']/;
    
    if (privateKeyRegex.test(sourceCode)) {
      vulnerabilities.push({
        name: 'Critical Security Risk: Hardcoded Private Key',
        severity: 'Critical',
        codeSnippet: '-- Redacted for security --',
        explanation: 'The contract contains what appears to be a hardcoded private key.',
        impact: 'Anyone with access to the source code can access the private key and gain complete control.',
        recommendation: 'Never hardcode private keys in contract code. Use secure external key management solutions.'
      });
    }
  
    // Check for hardcoded secret or API keys
    const secretKeyRegex = /(secret|SECRET|api|API|key|KEY|apiKey|ApiKey)[\s=]+["'][a-zA-Z0-9_\-+/=]{16,}["']/;
    
    if (secretKeyRegex.test(sourceCode)) {
      vulnerabilities.push({
        name: 'Security Risk: Hardcoded API/Secret Key',
        severity: 'Critical',
        codeSnippet: '-- Redacted for security --',
        explanation: 'The contract contains what appears to be a hardcoded API key, secret, or credential.',
        impact: 'Sensitive credentials in public blockchain code can be extracted and misused.',
        recommendation: 'Never store sensitive API keys or secrets in contract code. Use secure oracles or off-chain solutions.'
      });
    }
  
    return vulnerabilities;
  }
  
  // 9. Detect Gas Optimization Issues
  function detectGasOptimizationIssues(sourceCode: string, ast: ParseResult): Vulnerability[] {
    const vulnerabilities: Vulnerability[] = [];
  
    // Check for expensive operations in loops
    const loopsWithStorage = /(for|while)[\s\S]{0,100}([\w\s.]*=[\w\s.]*storage[\w\s.]*|[\w\s.]*storage[\w\s.]*=)/;
    
    if (loopsWithStorage.test(sourceCode)) {
      vulnerabilities.push({
        name: 'Gas Optimization: Storage Operations in Loop',
        severity: 'Medium',
        codeSnippet: extractCodeSnippet(sourceCode, loopsWithStorage),
        explanation: 'The contract performs storage operations within loops.',
        impact: 'High gas costs that could lead to block gas limit issues and expensive transactions.',
        recommendation: 'Cache storage variables to memory before the loop and update storage after the loop.'
      });
    }
  
    // Check for unbounded loops
    const unboundedLoops = /(for|while)[\s\S]{0,200}(\.length|msg\.sender)/;
    
    if (unboundedLoops.test(sourceCode)) {
      vulnerabilities.push({
        name: 'Gas Optimization: Potentially Unbounded Loop',
        severity: 'Medium',
        codeSnippet: extractCodeSnippet(sourceCode, unboundedLoops),
        explanation: 'The contract contains loops that may iterate over unbounded arrays or collections.',
        impact: 'Could exceed block gas limits if the array/collection grows large enough, causing DoS.',
        recommendation: 'Implement pagination or limits on loop iterations to prevent gas-limit DoS.'
      });
    }
  
    // Check for unnecessary SSTORE operations
    const repeatedStorage = /[\w\s.]*=[\w\s.]*storage[\w\s.]*[\s\S]{0,50}[\w\s.]*=[\w\s.]*storage[\w\s.]*/;
    
    if (repeatedStorage.test(sourceCode)) {
      vulnerabilities.push({
        name: 'Gas Optimization: Multiple Storage Operations',
        severity: 'Low',
        codeSnippet: extractCodeSnippet(sourceCode, repeatedStorage),
        explanation: 'The contract performs multiple storage operations that could be optimized.',
        impact: 'Higher than necessary gas costs for contract execution.',
        recommendation: 'Batch storage operations where possible and use memory variables for intermediate values.'
      });
    }
  
    // Check for using address(0) in require checks
    if (
      !sourceCode.includes('require(') || 
      !sourceCode.includes('address(0)') ||
      !sourceCode.includes('address(0x0)')
    ) {
      vulnerabilities.push({
        name: 'Missing Zero Address Validation',
        severity: 'Low',
        codeSnippet: '',
        explanation: 'The contract may not validate against zero address (0x0) inputs.',
        impact: 'Could lead to tokens or funds being sent to the zero address and permanently lost.',
        recommendation: 'Add require() checks to ensure critical address parameters are not the zero address.'
      });
    }
  
    return vulnerabilities;
  }
  
  // 10. Detect Front-Running Risks
  function detectFrontRunningRisks(sourceCode: string, ast: ParseResult): Vulnerability[] {
    const vulnerabilities: Vulnerability[] = [];
  
    // Check for price or value calculations based on block properties
    const blockPropertiesUsage = /(block\.(timestamp|number|difficulty|coinbase|gaslimit|basefee|hash))/;
    
    if (blockPropertiesUsage.test(sourceCode)) {
      vulnerabilities.push({
        name: 'Front-Running Risk: Block Properties Used in Calculations',
        severity: 'Medium',
        codeSnippet: extractCodeSnippet(sourceCode, blockPropertiesUsage),
        explanation: 'The contract uses block properties in calculations that may be manipulated by miners.',
        impact: 'Vulnerable to miner front-running and manipulation of block properties to gain advantage.',
        recommendation: 'Avoid using block properties for critical calculations. Use oracles or commit-reveal schemes.'
      });
    }
  
    // Check for high-value operations without protections
    if (
      (sourceCode.includes('swap') || 
       sourceCode.includes('trade') || 
       sourceCode.includes('buy') || 
       sourceCode.includes('sell')) && 
      !sourceCode.includes('deadline') &&
      !sourceCode.includes('minOutput') &&
      !sourceCode.includes('maxSlippage')
    ) {
      vulnerabilities.push({
        name: 'Front-Running Risk: Missing Transaction Guards',
        severity: 'High',
        codeSnippet: extractCodeSnippet(sourceCode, /(function\s+(swap|trade|buy|sell))/),
        explanation: 'Trading or swap functions lack front-running protections like deadlines or slippage controls.',
        impact: 'Transactions can be front-run by MEV bots or miners, causing users to receive worse execution prices.',
        recommendation: 'Implement deadline parameters, minimum output amounts, and maximum slippage tolerances.'
      });
    }
  
    // Check for first-depositor attack vulnerability
    if (
      sourceCode.includes('deposit') && 
      sourceCode.includes('totalSupply') &&
      (sourceCode.includes('== 0') || sourceCode.includes('=== 0'))
    ) {
      const depositFunc = extractCodeSnippet(sourceCode, 
        /function\s+deposit[\s\S]{0,500}totalSupply[\s\S]{0,100}==\s*0/
      );
      
      if (depositFunc) {
        vulnerabilities.push({
          name: 'Front-Running Risk: First-Depositor Attack',
          severity: 'Medium',
          codeSnippet: depositFunc,
          explanation: 'Special logic for the first deposit/mint may be vulnerable to front-running attacks.',
          impact: 'Attackers can front-run the first deposit with a minimal amount to gain disproportionate control.',
          recommendation: 'Initialize contracts with a minimal liquidity from a trusted source or use a different approach.'
        });
      }
    }
  
    return vulnerabilities;
  }
  
  // 11. Detect Proxy Contract Risks
  function detectProxyContractRisks(sourceCode: string, ast: ParseResult): Vulnerability[] {
    const vulnerabilities: Vulnerability[] = [];
  
    // Check if this is a proxy contract
    const isProxy = 
      sourceCode.includes('delegatecall') || 
      sourceCode.includes('upgradeability') ||
      sourceCode.includes('Proxy') ||
      sourceCode.includes('_implementation') ||
      sourceCode.includes('Upgradeable');
    
    if (!isProxy) {
      return [];
    }
  
    // Check for storage layout collisions in upgradeable contracts
    if (
      sourceCode.includes('Upgradeable') && 
      (sourceCode.match(/\s+contract\s+[a-zA-Z0-9_]+\s+is\s+[^{]*Upgradeable/) || []).length > 0
    ) {
      const storageVars = sourceCode.match(/\s+(uint|int|address|bool|bytes|string)[\s\[\]0-9]*\s+[a-zA-Z0-9_]+;/g) || [];
      
      if (storageVars.length > 0) {
        vulnerabilities.push({
          name: 'Proxy Contract Risk: Potential Storage Collision',
          severity: 'High',
          codeSnippet: storageVars.slice(0, 3).join('\n'),
          explanation: 'The upgradeable contract defines storage variables that may collide with the base implementation.',
          impact: 'Storage collisions can corrupt data or cause unexpected behavior after contract upgrades.',
          recommendation: 'Use OpenZeppelin\'s upgradeable contracts pattern with storage gaps or EIP-2535 Diamond pattern.'
        });
      }
    }
  
    // Check for missing initializer protection
    if (
      sourceCode.includes('function initialize') && 
      !sourceCode.includes('initializer')
    ) {
      vulnerabilities.push({
        name: 'Proxy Contract Risk: Unprotected Initializer',
        severity: 'Critical',
        codeSnippet: extractCodeSnippet(sourceCode, /function\s+initialize[a-zA-Z0-9_]*\s*\(/),
        explanation: 'The initialize function in the proxy/implementation contract lacks the initializer modifier.',
        impact: 'The contract can be reinitialized after deployment, potentially allowing attackers to reset the contract state.',
        recommendation: 'Add the initializer modifier to the initialize function to prevent multiple initializations.'
      });
    }
  
    // Check for delegate call risks
    if (sourceCode.includes('delegatecall(')) {
      vulnerabilities.push({
        name: 'Proxy Contract Risk: Delegatecall Usage',
        severity: 'High',
        codeSnippet: extractCodeSnippet(sourceCode, /delegatecall\(/),
        explanation: 'The contract uses delegatecall which executes code in the context of the calling contract.',
        impact: 'Improper use of delegatecall can allow attackers to modify the proxy\'s storage or behavior unexpectedly.',
        recommendation: 'Ensure delegatecall target addresses are strictly validated and implement proper access controls.'
      });
    }
  
    return vulnerabilities;
  }

// Function to extract code snippet from source code based on pattern
function extractCodeSnippet(sourceCode: string, pattern: string | RegExp): string {
  const regex = typeof pattern === 'string' ? new RegExp(pattern, 'g') : pattern;
  const match = regex.exec(sourceCode);
  
  if (match) {
    // Get context around the match (about 3 lines)
    const startPos = Math.max(0, match.index - 100);
    const endPos = Math.min(sourceCode.length, match.index + match[0].length + 100);
    
    // Extract the snippet with context
    const snippet = sourceCode.substring(startPos, endPos);
    
    // Find line boundaries
    const lineStartPos = snippet.indexOf('\n') === -1 ? 0 : snippet.indexOf('\n');
    const lineEndPos = snippet.lastIndexOf('\n') === -1 ? snippet.length : snippet.lastIndexOf('\n');
    
    // Refine the snippet to complete lines
    return snippet.substring(lineStartPos, lineEndPos).trim();
  }
  
  return '';
}

// Rename this function to avoid conflicts with Next.js route handlers
function _analyzeContractSecurity(sourceCode: string, ast: ParseResult, contractAddress: string = ''): Vulnerability[] {
  let vulnerabilities: Vulnerability[] = [];
  
  // Run all detection functions
  vulnerabilities = vulnerabilities.concat(
    detectReentrancyVulnerabilities(sourceCode, ast),
    detectIntegerOverflows(sourceCode, ast),
    detectUncheckedExternalCalls(sourceCode, ast),
    detectHardcodedAddresses(sourceCode, ast, contractAddress),
    detectGasOptimizationIssues(sourceCode, ast),
    detectFrontRunningRisks(sourceCode, ast),
    detectProxyContractRisks(sourceCode, ast)
    // Add more detection functions here
  );
  
  // Sort vulnerabilities by severity
  return vulnerabilities.sort((a, b) => {
    const severityOrder = {
      'Critical': 0,
      'High': 1,
      'Medium': 2,
      'Low': 3,
      'Informational': 4
    };
    
    return severityOrder[a.severity as keyof typeof severityOrder] - severityOrder[b.severity as keyof typeof severityOrder];
  });
}