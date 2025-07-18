import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

// Block explorer API endpoints
const EXPLORER_ENDPOINTS = {
  // Etherscan
  1: 'https://api.etherscan.io/api', // Mainnet
  5: 'https://api-goerli.etherscan.io/api', // Goerli
  11155111: 'https://api-sepolia.etherscan.io/api', // Sepolia
  17000: 'https://api-holesky.etherscan.io/api', // Holesky
  
  // Polygonscan
  137: 'https://api.polygonscan.com/api', // Polygon Mainnet
  80001: 'https://api-testnet.polygonscan.com/api', // Mumbai Testnet
};

// Get the appropriate API key for the network
function getApiKey(chainId: number): string | undefined {
  if ([1, 5, 11155111, 17000].includes(chainId)) {
    return process.env.ETHERSCAN_API_KEY;
  } else if ([137, 80001].includes(chainId)) {
    return process.env.POLYGONSCAN_API_KEY;
  }
  return undefined;
}

// Get explorer name for logging
function getExplorerName(chainId: number): string {
  if ([1, 5, 11155111, 17000].includes(chainId)) {
    return 'Etherscan';
  } else if ([137, 80001].includes(chainId)) {
    return 'Polygonscan';
  }
  return 'Unknown Explorer';
}

// Add a delay function
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to flatten imports for contract verification
async function flattenContract(contractCode: string): Promise<string> {
  // Add SPDX and pragma at the top if they're missing
  let flattenedCode = contractCode;
  
  // Collect all OpenZeppelin imports
  const importRegex = /import\s+["']@openzeppelin\/contracts\/(.+?)["'];/g;
  let match;
  const imports = new Set<string>();
  
  while ((match = importRegex.exec(contractCode)) !== null) {
    imports.add(match[0]);
  }
  
  // Add SPDX license identifier if missing
  if (!flattenedCode.includes('SPDX-License-Identifier')) {
    flattenedCode = '// SPDX-License-Identifier: MIT\n' + flattenedCode;
  }
  
  // Ensure we have pragma
  if (!flattenedCode.includes('pragma solidity')) {
    flattenedCode = flattenedCode.replace('// SPDX-License-Identifier: MIT', 
      '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;');
  }
  
  // Replace imports with actual file contents
  for (const importStatement of imports) {
    try {
      const filePath = importStatement.match(/@openzeppelin\/contracts\/(.+?)["']/)?.[1];
      if (!filePath) continue;
      
      const fullPath = path.join(process.cwd(), 'node_modules', '@openzeppelin', 'contracts', filePath);
      
      if (fs.existsSync(fullPath)) {
        const fileContent = fs.readFileSync(fullPath, 'utf8').trim();
        
        // Remove SPDX and pragma from imported files to avoid duplicates
        const cleanedContent = fileContent
          .replace(/\/\/\s*SPDX-License-Identifier:.*\n/g, '')
          .replace(/pragma\s+solidity.*?;/g, '');
        
        // Replace the import with the file content, commented
        flattenedCode = flattenedCode.replace(
          importStatement, 
          `// ${importStatement} (flattened)\n${cleanedContent}\n`
        );
      }
    } catch (error) {
      console.error(`Error processing import:`, error);
    }
  }
  
  // Remove duplicate imports
  const lines = flattenedCode.split('\n');
  const uniqueLines = new Set<string>();
  const result: string[] = [];
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    // Skip empty lines and duplicate imports
    if (trimmedLine === '' || (trimmedLine.startsWith('import') && uniqueLines.has(trimmedLine))) {
      continue;
    }
    uniqueLines.add(trimmedLine);
    result.push(line);
  }
  
  return result.join('\n');
}

// Function to check verification status with guid
async function checkVerificationStatus(apiEndpoint: string, apiKey: string, guid: string): Promise<boolean> {
  try {
    // Construct the status check request
    const statusParams = new URLSearchParams({
      apikey: apiKey,
      module: 'contract',
      action: 'checkverifystatus',
      guid: guid
    });

    // Make the request
    const response = await fetch(`${apiEndpoint}?${statusParams.toString()}`);
    if (!response.ok) {
      console.error(`Status check failed with code ${response.status}`);
      return false;
    }

    const result = await response.json();
    console.log("Verification status check result:", result);

    if (result.status === '1' && result.result.toLowerCase().includes('verified')) {
      console.log("Contract successfully verified!");
      return true;
    }

    return false;
  } catch (error) {
    console.error("Error checking verification status:", error);
    return false;
  }
}

// Update the main function to include retries
export async function POST(request: Request) {
  try {
    const { address, constructorArguments, sourceCode, chainId, network } = await request.json();

    console.log('Verifying contract:', {
      address,
      chainId,
      network,
      constructorArgs: constructorArguments,
      contractName: sourceCode?.match(/contract\s+(\w+)/)?.[1] || '',
    });

    // Validate required fields
    if (!address || !sourceCode || !chainId) {
      console.error('Missing required fields:', { address, sourceCode: !!sourceCode, chainId });
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get API endpoint for the network
    const apiEndpoint = EXPLORER_ENDPOINTS[chainId as keyof typeof EXPLORER_ENDPOINTS];
    if (!apiEndpoint) {
      console.error('Unsupported network for verification:', chainId, network);
      return NextResponse.json({ 
        error: 'Unsupported network',
        message: `No verification API support for network: ${network || chainId}`
      }, { status: 400 });
    }

    // Get the appropriate API key for the network
    const apiKey = getApiKey(chainId);
    if (!apiKey) {
      console.error(`${getExplorerName(chainId)} API key not configured for chain ID ${chainId}`);
      return NextResponse.json({ 
        error: 'API key not configured',
        message: `${getExplorerName(chainId)} API key not found in environment variables`
      }, { status: 500 });
    }

    // Extract contract name
    const contractName = sourceCode.match(/contract\s+(\w+)/)?.[1] || '';
    console.log('Detected contract name:', contractName);

    // Process constructor arguments
    // Need to convert constructor arguments to hex format without 0x prefix
    const processedArgs = constructorArguments
      ? encodeConstructorArgs(constructorArguments)
      : '';
    
    console.log('Processed constructor arguments:', processedArgs);

    // Add delay for all chains to ensure contract indexing
    console.log(`Waiting for ${getExplorerName(chainId)} to index the contract...`);
    // Different delays based on network speed - use same delays for Ethereum and Polygon
    if ([1, 137].includes(chainId)) {
      // Mainnet networks - longer delay
      await delay(12000);
    } else {
      // All testnets - use same delay
      await delay(12000);
    }

    // Check if the contract code has imports - if so, use multi-file format
    let sourceCodeFormat = 'solidity-single-file';
    let sourceCodeToSend = sourceCode;

    // Use enhanced verification for all networks
    console.log(`Using enhanced verification for ${getExplorerName(chainId)}`);
    // All networks need special handling for successful verification
    sourceCodeFormat = 'solidity-single-file';
    
    try {
      // Try to flatten the contract for better verification results
      // Flattening is critical for verification
      const flattenedCode = await flattenContract(sourceCode);
      sourceCodeToSend = flattenedCode;
      console.log(`Successfully flattened contract code for ${getExplorerName(chainId)} verification`);
    } catch (flattenError) {
      console.error(`Error flattening contract for ${getExplorerName(chainId)}:`, flattenError);
      sourceCodeToSend = sourceCode; // Fall back to original code
    }

    // Prepare verification data
    const verificationData = {
      apikey: apiKey,
      module: 'contract',
      action: 'verifysourcecode',
      contractaddress: address,
      sourceCode: sourceCodeToSend,
      codeformat: sourceCodeFormat,
      contractname: contractName,
      compilerversion: 'v0.8.20+commit.a1b79de6', // Use latest stable version
      optimizationUsed: 1,
      runs: 200,
      constructorArguements: processedArgs, // Note: API expects this typo in the parameter name
      evmversion: 'london', // Use London EVM version for better compatibility
      licenseType: 3, // MIT License
    };

    // Add direct API URL for better tracking for all networks
    if ([1, 5, 11155111, 17000].includes(chainId)) {
      const domain = chainId === 1 ? 'etherscan.io' : 
                     chainId === 5 ? 'goerli.etherscan.io' : 
                     chainId === 11155111 ? 'sepolia.etherscan.io' : 
                     'holesky.etherscan.io';
      console.log(`Verification will be available at: https://${domain}/address/${address}#code`);
    } else if ([137, 80001].includes(chainId)) {
      console.log(`Verification will be available at: https://${
        chainId === 137 ? 'polygonscan.com' : 'mumbai.polygonscan.com'
      }/address/${address}#code`);
    }

    console.log(`Submitting verification request to ${getExplorerName(chainId)}:`, apiEndpoint);

    // Implement network-specific retry logic
    // Use same retry count and delay for all networks
    const getNetworkRetrySettings = () => {
      // Use same settings for all networks
      return { maxRetries: 8, baseDelay: 12000 };
    };

    const { maxRetries, baseDelay } = getNetworkRetrySettings();
    let retryCount = 0;
    let lastError;
    let result;

    while (retryCount < maxRetries) {
      try {
        // Submit verification request
        const response = await fetch(apiEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(
            Object.entries(verificationData).reduce(
              (acc, [key, value]) => ({ ...acc, [key]: String(value) }),
              {} as Record<string, string>
            )
          ).toString(),
        });

        console.log(`Verification response status (attempt ${retryCount + 1}):`, response.status);

        if (!response.ok) {
          throw new Error(`Failed to submit verification request. Status: ${response.status}`);
        }

        result = await response.json();
        console.log(`Verification result (attempt ${retryCount + 1}):`, result);

        // If response includes "Unable to locate ContractCode", wait and retry
        if (result.result && typeof result.result === 'string' && 
            (result.result.includes('Unable to locate ContractCode') || 
             result.result.includes('not been verified'))) {
          
          console.log(`Contract not yet indexed on ${getExplorerName(chainId)}, waiting...`);
          await delay(baseDelay * (retryCount + 1)); // Increase delay with each retry
          retryCount++;
          continue;
        }

        // If we got a successful response or any other error, break out of the loop
        break;
      } catch (error) {
        lastError = error;
        console.error(`Verification attempt ${retryCount + 1} failed:`, error);
        
        // Wait before retrying with network-specific timing
        await delay(baseDelay * (retryCount + 1));
        retryCount++;
      }
    }

    // Check if we exhausted all retries with no result
    if (!result && lastError) {
      throw lastError;
    }

    if (result.status === '1') {
      // Get the verification GUID
      const guid = result.result;
      console.log(`Verification submitted with GUID: ${guid}`);
      
      // Check verification status
      let isVerified = false;
      try {
        // Wait a bit for verification to process
        await delay(8000);
        isVerified = await checkVerificationStatus(apiEndpoint, apiKey, guid);
      } catch (statusError) {
        console.error("Error checking verification status:", statusError);
      }
      
      // Return success with the GUID
      return NextResponse.json({ 
        status: isVerified ? 'success' : 'pending', 
        guid,
        verified: isVerified,
        message: isVerified 
          ? `Contract verification completed successfully on ${getExplorerName(chainId)}` 
          : `Contract verification submitted successfully to ${getExplorerName(chainId)}`
      });
    } else {
      // After a failed verification attempt, try alternate verification method for all networks
      if (retryCount === maxRetries - 1 && result?.status !== '1') {
        console.log(`Attempting alternate verification method for ${getExplorerName(chainId)}...`);
        
        // Try the opposite format than what we used before
        if (sourceCodeFormat === 'solidity-single-file') {
          console.log("Switching to standard-json-input format for final attempt");
          sourceCodeFormat = 'solidity-standard-json-input';
          
          const jsonInput = {
            language: 'Solidity',
            sources: {
              'contract.sol': {
                content: sourceCode
              }
            },
            settings: {
              optimizer: {
                enabled: true,
                runs: 200
              }
            }
          };
          
          sourceCodeToSend = JSON.stringify(jsonInput);
        } else {
          console.log("Switching to single-file format for final attempt");
          sourceCodeFormat = 'solidity-single-file';
          sourceCodeToSend = sourceCode;
        }
        
        // Update verification data with new format
        verificationData.sourceCode = sourceCodeToSend;
        verificationData.codeformat = sourceCodeFormat;
      }

      return NextResponse.json(
        { 
          status: 'pending', 
          message: result.result,
          explorer: getExplorerName(chainId),
          note: 'Contract verification may be delayed due to blockchain indexing. You can manually verify later if needed.'
        },
        { status: 200 } // Return 200 even if verification is pending
      );
    }
  } catch (error) {
    console.error('Contract verification error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to verify contract', 
        details: error instanceof Error ? error.message : String(error),
        note: 'You can try to verify the contract manually on the block explorer after a few minutes.'
      },
      { status: 500 }
    );
  }
}

// Helper function to encode constructor arguments
function encodeConstructorArgs(args: Array<string | number | bigint>): string {
  try {
    // For proper ABI encoding, we need to handle the ERC20 constructor args:
    // string name, string symbol, uint8 decimals, uint256 totalSupply
    
    let encodedArgs = '';
    
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      
      if (i === 0 || i === 1) {
        // For name and symbol (strings)
        if (typeof arg === 'string') {
          // Get byte length (utf-8 encoded)
          const bytes = Buffer.from(arg);
          const length = bytes.length;
          
          // Encode string length - padded to 32 bytes
          encodedArgs += BigInt(length).toString(16).padStart(64, '0');
          
          // Encode the string data, padded to multiple of 32 bytes
          // Calculate how many 32-byte chunks we need (32 bytes = 64 hex chars)
          const paddedHex = bytes.toString('hex');
          const padding = 64 - (paddedHex.length % 64);
          encodedArgs += paddedHex + (padding < 64 ? '0'.repeat(padding) : '');
        }
      } else if (i === 2) {
        // For decimals (uint8)
        encodedArgs += BigInt(arg).toString(16).padStart(64, '0');
      } else if (i === 3) {
        // For totalSupply (uint256)
        encodedArgs += BigInt(arg).toString(16).padStart(64, '0');
      }
    }
    
    console.log("Encoded arguments by type:");
    for (let i = 0; i < args.length; i++) {
      console.log(`Arg ${i} (${typeof args[i]}):`, args[i]);
    }
    
    return encodedArgs;
  } catch (error) {
    console.error('Error encoding constructor arguments:', error);
    return '';
  }
} 