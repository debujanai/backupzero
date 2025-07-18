import { NextResponse } from 'next/server';
import solc from 'solc';
import path from 'path';
import fs from 'fs';

// Function to read imported files
function findImports(importPath: string) {
  try {
    // Remove @openzeppelin prefix and convert to filesystem path
    const normalizedPath = importPath.replace('@openzeppelin/contracts/', '');
    const fullPath = path.join(process.cwd(), 'node_modules', '@openzeppelin', 'contracts', normalizedPath);
    
    if (fs.existsSync(fullPath)) {
      return {
        contents: fs.readFileSync(fullPath, 'utf8')
      };
    } else {
      return { error: `File not found: ${importPath}` };
    }
  } catch (error) {
    return { error: `Error reading file: ${error}` };
  }
}

// Contract template with gas optimization features
const CONTRACT_TEMPLATE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
{{IMPORTS}}

contract {{TOKEN_NAME}} is ERC20, Ownable{{INHERITANCE}} {
    uint8 private immutable _decimals;
    {{VARIABLES}}
    
    // Tax settings
    uint256 public buyTax;
    uint256 public sellTax;
    address public taxWallet;
    
    // Router addresses for tax detection
    mapping(address => bool) public isRouter;
    
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 initialSupply_,
        uint256 buyTax_,
        uint256 sellTax_
    ) 
        ERC20(name_, symbol_)
        Ownable()
        {{CONSTRUCTOR_INITIALIZERS}}
    {
        _decimals = decimals_;
        {{CONSTRUCTOR_BODY}}
        
        // Initialize taxes to 0 - will be set in separate transactions after deployment
        buyTax = 0;
        sellTax = 0;
        taxWallet = msg.sender;
        
        // Add known router addresses for tax detection
        isRouter[address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2)] = true; // WETH
        isRouter[address(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D)] = true; // Uniswap V2 Router
        isRouter[address(0xE592427A0AEce92De3Edee1F18E0157C05861564)] = true; // Uniswap V3 Router
        isRouter[address(0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270)] = true; // WMATIC
        isRouter[address(0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff)] = true; // QuickSwap Router
        
        _mint(msg.sender, initialSupply_ * 10 ** decimals_);
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }
    
    // Override transfer function to apply taxes
    function _transfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        // Skip taxes for certain addresses or when taxes are zero
        if (from == taxWallet || to == taxWallet || (buyTax == 0 && sellTax == 0)) {
            super._transfer(from, to, amount);
            return;
        }
        
        uint256 taxAmount = 0;
        
        // Apply buy tax when buying from a router (router -> user)
        if (isRouter[from]) {
            // Tax calculation: 1% = 100 basis points, divided by 10000 to get the actual percentage
            // Example: 500 basis points (5%) ÷ 10000 = 0.05 (5%)
            taxAmount = amount * buyTax / 10000;
        }
        // Apply sell tax when selling to a router (user -> router)
        else if (isRouter[to]) {
            // Tax calculation: 1% = 100 basis points, divided by 10000 to get the actual percentage
            // Example: 500 basis points (5%) ÷ 10000 = 0.05 (5%)
            taxAmount = amount * sellTax / 10000;
        }
        
        // Transfer tax amount to tax wallet if there's any tax
        if (taxAmount > 0) {
            super._transfer(from, taxWallet, taxAmount);
            super._transfer(from, to, amount - taxAmount);
        } else {
            super._transfer(from, to, amount);
        }
    }
    
    // Function to set buy tax - separate transaction after deployment
    function setBuyTax(uint256 newBuyTax) public onlyOwner {
        require(newBuyTax <= 5000, "Tax cannot exceed 50%");
        buyTax = newBuyTax;
    }
    
    // Function to set sell tax - separate transaction after deployment
    function setSellTax(uint256 newSellTax) public onlyOwner {
        require(newSellTax <= 5000, "Tax cannot exceed 50%");
        sellTax = newSellTax;
    }
    
    // Function to update tax settings - combined function
    function setTaxes(uint256 newBuyTax, uint256 newSellTax) public onlyOwner {
        require(newBuyTax <= 5000 && newSellTax <= 5000, "Tax cannot exceed 50%");
        buyTax = newBuyTax;
        sellTax = newSellTax;
    }
    
    // Function to update tax wallet
    function setTaxWallet(address newTaxWallet) public onlyOwner {
        require(newTaxWallet != address(0), "Cannot set to zero address");
        taxWallet = newTaxWallet;
    }
    
    // Function to add or remove router addresses
    function setRouter(address router, bool isActive) public onlyOwner {
        isRouter[router] = isActive;
    }
    
    {{FUNCTIONS}}
}`;

// Feature imports and implementations
const FEATURE_TEMPLATES = {
  Mintable: {
    imports: [],
    inheritance: '',
    variables: '',
    constructorBody: '',
    functions: `
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }`,
  },
  Burnable: {
    imports: ['import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";'],
    inheritance: ', ERC20Burnable',
    variables: '',
    constructorBody: '',
    functions: '',
  },
  Pausable: {
    imports: ['import "@openzeppelin/contracts/security/Pausable.sol";'],
    inheritance: ', Pausable',
    variables: '',
    constructorBody: '',
    functions: `
    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }`,
  },
  'Access Control': {
    imports: ['import "@openzeppelin/contracts/access/AccessControl.sol";'],
    inheritance: ', AccessControl',
    variables: `
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");`,
    constructorBody: `
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(BURNER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);`,
    functions: `
    function mint(address to, uint256 amount) public onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) public onlyRole(BURNER_ROLE) {
        _burn(from, amount);
    }
    
    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }
    
    function unpause() public onlyRole(PAUSER_ROLE) {
        _unpause();
    }`,
  },
  'Flash Minting': {
    imports: ['import "@openzeppelin/contracts/token/ERC20/extensions/ERC20FlashMint.sol";'],
    inheritance: ', ERC20FlashMint',
    variables: '',
    constructorBody: '',
    functions: '',
  },
};

// Gas optimization settings
const OPTIMIZATION_SETTINGS = {
  none: {
    enabled: false,
    runs: 200,
  },
  standard: {
    enabled: true,
    runs: 200,
  },
  high: {
    enabled: true,
    runs: 1000,
  },
};

export async function POST(request: Request) {
  console.log('Contract generation API called');
  try {
    const body = await request.json();
    console.log('Request body:', body);
    
    const { contractDetails } = body;
    
    if (!contractDetails) {
      console.error('No contract details provided');
      return NextResponse.json({ error: 'Contract details are required' }, { status: 400 });
    }

    console.log('Received contract details:', contractDetails);

    const {
      name,
      symbol,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      decimals = '18',
      totalSupply,
      features = [],
      optimizationLevel = 'standard',
      logoUrl = '',
      buyTax = 0,
      sellTax = 0,
    } = contractDetails;

    // Log tax settings
    console.log('Tax settings:', { buyTax, sellTax });

    // Validate required fields
    if (!name || !symbol || !totalSupply) {
      console.error('Missing required fields:', {
        name: !name ? 'missing' : 'ok',
        symbol: !symbol ? 'missing' : 'ok',
        totalSupply: !totalSupply ? 'missing' : 'ok'
      });
      return NextResponse.json({ 
        error: 'Missing required fields',
        details: {
          name: !name ? 'Token name is required' : undefined,
          symbol: !symbol ? 'Token symbol is required' : undefined,
          totalSupply: !totalSupply ? 'Total supply is required' : undefined,
        }
      }, { status: 400 });
    }

    // Generate contract code
    console.log('Generating contract code...');
    let contractCode = CONTRACT_TEMPLATE;
    // eslint-disable-next-line prefer-const
    let imports: string[] = [];
    let inheritance = '';
    let variables = '';
    let constructorBody = '';
    let functions = '';

    // Add selected features
    console.log('Adding selected features:', features);
    
    // Extract feature names for easier processing
    const featureNames: string[] = [];
    features.forEach((feature: string | {type?: string, name?: string, enabled?: boolean}) => {
      // Handle both string features and object features
      let featureName = feature;
      
      // If feature is an object with a type property, use that
      if (typeof feature === 'object' && feature !== null) {
        if (feature.type) {
          featureName = feature.type;
        } else if (feature.name) {
          featureName = feature.name;
        }
        // Only use enabled features if that property exists
        if (feature.enabled === false) {
          return; // Skip disabled features
        }
      }
      
      // Convert to string in case it's not already
      featureName = String(featureName);
      featureNames.push(featureName);
    });
    
    // Process features in a specific order to handle dependencies
    const orderedFeatures = ['Access Control', 'Pausable', 'Burnable', 'Mintable', 'Flash Minting'];
    
    // Sort features based on defined order
    const sortedFeatures = featureNames.sort((a, b) => {
      const indexA = orderedFeatures.indexOf(a);
      const indexB = orderedFeatures.indexOf(b);
      // If feature is not in the orderedFeatures list, push it to the end
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });

    console.log('Sorted features for processing:', sortedFeatures);

    // Special case: If both Access Control and Pausable are selected, modify the Pausable implementation
    const hasAccessControl = sortedFeatures.includes('Access Control');
    const hasPausable = sortedFeatures.includes('Pausable');
    const hasBurnable = sortedFeatures.includes('Burnable');
    const hasMintable = sortedFeatures.includes('Mintable');
    const hasFlashMinting = sortedFeatures.includes('Flash Minting');
    
    // Log feature combinations for debugging
    console.log('Feature combinations:', {
      hasAccessControl,
      hasPausable,
      hasBurnable,
      hasMintable,
      hasFlashMinting
    });
    
    // Create a custom function map to avoid duplications for multiple features
    const resolvedFunctions = new Map();
    
    // Process each feature
    sortedFeatures.forEach((featureName: string) => {
      const template = FEATURE_TEMPLATES[featureName as keyof typeof FEATURE_TEMPLATES];
      if (template) {
        // Deduplicate imports and avoid duplicate Ownable
        template.imports.forEach(importStatement => {
          if (!imports.includes(importStatement)) {
            imports.push(importStatement);
          }
        });
        
        // Avoid duplicate inheritance
        if (template.inheritance && !inheritance.includes(template.inheritance)) {
          inheritance += template.inheritance;
        }
        
        variables += template.variables;
        constructorBody += template.constructorBody;
        
        // Special handling for combinations of features
        if (featureName === 'Pausable' && hasAccessControl) {
          // Skip the pause/unpause functions as they're already included in Access Control
          
          const pauseFunc = `
    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }`;
          
          const unpauseFunc = `
    function unpause() public onlyRole(PAUSER_ROLE) {
        _unpause();
    }`;
          
          resolvedFunctions.set('pause', pauseFunc);
          resolvedFunctions.set('unpause', unpauseFunc);
        } else if (featureName === 'Access Control') {
          // For Access Control - special handling based on which other features are present
          const accessControlFunctions = template.functions.trim();
          
          // Split into individual functions and process
          const functions = accessControlFunctions.split('function');
          for (let i = 1; i < functions.length; i++) {
            const func = 'function' + functions[i];
            
            // Skip mint function if Mintable isn't selected (to avoid duplication)
            if (func.includes('mint(') && !hasMintable) {
              continue;
            }
            
            // Skip burn function if Burnable isn't selected
            if (func.includes('burn(') && !hasBurnable) {
              continue;
            }
            
            // Skip pause/unpause if Pausable isn't selected
            if ((func.includes('pause()') || func.includes('unpause()')) && !hasPausable) {
              continue;
            }
            
            // Skip _beforeTokenTransfer for now
            if (func.includes('_beforeTokenTransfer')) {
              continue;
            }
            
            const funcName = func.substring(9, func.indexOf('(')).trim();
            resolvedFunctions.set(funcName, func);
          }
        } else {
          // For other features or when there are no special combinations
          const featureFunctions = template.functions.trim();
          if (featureFunctions) {
            const functions = featureFunctions.split('function');
            for (let i = 1; i < functions.length; i++) {
              const func = 'function' + functions[i];
              
              // Skip _beforeTokenTransfer - we'll handle it separately
              if (func.includes('_beforeTokenTransfer')) {
                continue;
              }
              
              const funcName = func.substring(9, func.indexOf('(')).trim();
              resolvedFunctions.set(funcName, func);
            }
          }
        }
      }
    });
    
    // Now add the _beforeTokenTransfer function with correct implementation 
    // based on OpenZeppelin's actual implementation
    if (hasPausable) {
      // After thorough investigation of OpenZeppelin's code:
      // Pausable applies whenNotPaused modifier but doesn't actually override _beforeTokenTransfer
      // So we only need to override ERC20's implementation and add the whenNotPaused modifier
      const beforeTokenTransferFunc = `
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override whenNotPaused {
        super._beforeTokenTransfer(from, to, amount);
    }`;
      
      resolvedFunctions.set('_beforeTokenTransfer', beforeTokenTransferFunc);
    }
    
    // Combine all the resolved functions
    functions = Array.from(resolvedFunctions.values()).join('\n\n    ');
    
    // Replace placeholders
    const tokenName = name.replace(/\s+/g, '');
    
    // Build proper constructor inheritance as separate initializers
    let constructorInitializers = '';
    if (hasAccessControl) {
      constructorInitializers += 'AccessControl()\n        ';
    }
    if (hasPausable) {
      constructorInitializers += 'Pausable()\n        ';
    }

    // Don't automatically transfer ownership - we'll handle it separately
    // Let constructorBody be just the additional code without automatic _transferOwnership
    
    contractCode = CONTRACT_TEMPLATE
      .replace('{{IMPORTS}}', imports.join('\n'))
      .replace(/{{TOKEN_NAME}}/g, tokenName)
      .replace('{{TOKEN_SYMBOL}}', symbol)
      .replace('{{INHERITANCE}}', inheritance)
      .replace('{{VARIABLES}}', variables)
      .replace('{{CONSTRUCTOR_BODY}}', constructorBody)
      .replace('{{FUNCTIONS}}', functions)
      .replace('{{CONSTRUCTOR_INITIALIZERS}}', constructorInitializers);

    // Create the actual contract for compilation
    console.log('Creating compilation source...');
    const compilationSource = contractCode;

    console.log('Compilation source:', compilationSource);

    // Prepare compiler input
    console.log('Preparing compiler input...');
    const input = {
      language: 'Solidity',
      sources: {
        'Token.sol': {
          content: compilationSource,
        },
      },
      settings: {
        optimizer: OPTIMIZATION_SETTINGS[optimizationLevel as keyof typeof OPTIMIZATION_SETTINGS],
        outputSelection: {
          '*': {
            '*': ['*'],
          },
        },
      },
    };

    console.log('Compiler input:', input);

    // Compile contract
    console.log('Compiling contract...');
    try {
      const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
      console.log('Compilation output:', output);

      // Check for compilation errors
      if (output.errors?.length > 0) {
        console.log('Found compilation messages:', output.errors);
        const errors = output.errors.map((error: {severity: string, message: string, sourceLocation?: {file: string, start: number}}) => ({
          severity: error.severity,
          message: error.message,
          source: error.sourceLocation?.file,
          line: error.sourceLocation?.start,
        }));

        console.log('Processed errors:', errors);
        const hasError = errors.some((error: {severity: string}) => error.severity === 'error');
        if (hasError) {
          console.error('Compilation failed with errors');
          return NextResponse.json({
            error: 'Compilation failed',
            details: errors
          }, { status: 400 });
        }
      }

      // Extract compiled contract data
      console.log('Extracting compiled contract data...');
      const contract = output.contracts?.['Token.sol']?.[tokenName];
      if (!contract) {
        console.error('No contract output found');
        return NextResponse.json({
          error: 'Failed to compile contract',
          details: 'No contract output found'
        }, { status: 400 });
      }

      console.log('Successfully compiled contract');
      return NextResponse.json({
        contractCode: compilationSource,
        abi: contract.abi,
        bytecode: contract.evm.bytecode.object,
        logoUrl,
      });
    } catch (compileError) {
      console.error('Solidity compilation error:', compileError);
      return NextResponse.json({
        error: 'Failed to compile contract',
        details: compileError instanceof Error ? compileError.message : String(compileError)
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Contract generation error:', error);
    return NextResponse.json({
      error: 'Failed to generate contract',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
} 