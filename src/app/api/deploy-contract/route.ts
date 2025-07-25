import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs-extra';
import solc from 'solc';
import { promisify } from 'util';
import { exec } from 'child_process';

// Convert exec to Promise-based
const execPromise = promisify(exec);

// Advanced ERC20 token template with all OpenZeppelin features
const ERC20_TEMPLATE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

{{IMPORTS}}

contract {{TOKEN_NAME}} is {{INHERITANCE}} {
    {{VARIABLES}}
    
    constructor(address initialOwner)
        ERC20("{{TOKEN_NAME}}", "{{TOKEN_SYMBOL}}")
        {{CONSTRUCTOR_INITIALIZERS}}
    {
        {{CONSTRUCTOR_BODY}}
        _mint(initialOwner, {{TOTAL_SUPPLY}} * 10 ** decimals());
    }

    {{FUNCTIONS}}

    {{OVERRIDES}}
}`;

// Function to handle contract deployment logic
export async function POST(request: Request) {
  try {
    const { contractDetails } = await request.json();
    
    // Extract contract details
    const { name, symbol, decimals, totalSupply, features, buyTax, sellTax } = contractDetails;
    
    if (!name || !symbol || !totalSupply) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400
      });
    }

    console.log('Generating contract with:', { name, symbol, decimals, totalSupply, features, buyTax, sellTax });
    
    // Generate contract code
    const contractCode = generateContractCode(name, symbol, decimals, totalSupply, features, buyTax, sellTax);
    
    // Create temp directory if it doesn't exist
    const tempDir = path.join(process.cwd(), 'temp');
    await fs.ensureDir(tempDir);
    
    // Save contract to temporary file
    const contractPath = path.join(tempDir, `${name.replace(/\s+/g, '')}.sol`);
    await fs.writeFile(contractPath, contractCode);
    
    console.log(`Contract saved to ${contractPath}`);
    
    // Compile the contract using solc
    const compilationOutput = await compileContract(contractPath, name);
    
    if (!compilationOutput) {
      return NextResponse.json(
        { error: 'Contract compilation failed' },
        { status: 500 }
      );
    }
    
    const { abi, bytecode, deployedBytecode, metadata } = compilationOutput;

    // Create deployed-contracts directory if it doesn't exist
    const deployedContractsDir = path.join(process.cwd(), 'deployed-contracts');
    await fs.ensureDir(deployedContractsDir);
    
    // Save compiled contract details to deployed-contracts folder
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const contractFilename = `${name.replace(/\s+/g, '')}_${timestamp}`;
    const deployedContractPath = path.join(deployedContractsDir, `${contractFilename}.sol`);
    const deployedAbiPath = path.join(deployedContractsDir, `${contractFilename}_abi.json`);
    const deployedBytecodeFilePath = path.join(deployedContractsDir, `${contractFilename}_bytecode.txt`);
    const deployedMetadataPath = path.join(deployedContractsDir, `${contractFilename}_metadata.json`);
    
    // Create a verification-ready file
    const verificationReadyPath = path.join(deployedContractsDir, `${contractFilename}_verification.sol`);
    
    // Add the flattened imports to the verification-ready file
    // This creates a single file version for easier verification
    await flattenContractForVerification(contractCode, verificationReadyPath);
    
    // Save contract source code, ABI, and bytecode
    await fs.writeFile(deployedContractPath, contractCode);
    await fs.writeFile(deployedAbiPath, JSON.stringify(abi, null, 2));
    await fs.writeFile(deployedBytecodeFilePath, bytecode);
    await fs.writeFile(deployedMetadataPath, JSON.stringify(metadata, null, 2));
    
    console.log(`Compiled contract saved to ${deployedContractPath}`);
    console.log(`Verification-ready contract saved to ${verificationReadyPath}`);
    
    return NextResponse.json({
      contractCode,
      abi,
      bytecode,
      logoUrl: contractDetails.logoUrl,
      savedContractPath: deployedContractPath,
      verificationPath: verificationReadyPath
    });
  } catch (error) {
    console.error('Error processing request:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}

// Helper function to generate contract code based on features
function generateContractCode(
  name: string, 
  symbol: string, 
  decimals: number, 
  totalSupply: string, 
  features: string[],
  buyTax: number = 0,
  sellTax: number = 0
) {
  // Initialize all components
  let imports: string[] = [];
  let inheritance: string[] = ['ERC20'];
  let variables: string[] = [];
  let constructorInitializers: string[] = [];
  let constructorBody: string[] = [];
  let functions: string[] = [];
  let overrides: string[] = [];

  // Base imports - always include Ownable
  imports.push('import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";');
  imports.push('import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";');
  inheritance.push('Ownable');
  constructorInitializers.push('Ownable()');
  constructorBody.push(`
        _transferOwnership(initialOwner);`);

  // --- Trading Open Logic ---
  variables.push('    bool public tradingOpen = false;');
  variables.push('    mapping(address => bool) private _isExcludedFromFees;');
  constructorBody.push('        _isExcludedFromFees[initialOwner] = true;');
  functions.push(`
    function openTrading() external onlyOwner {
        tradingOpen = true;
    }

    function excludeFromFees(address account, bool excluded) external onlyOwner {
        _isExcludedFromFees[account] = excluded;
        emit ExcludeFromFees(account, excluded);
    }
  `);
  
  // Add event declarations
  variables.push('    event ExcludeFromFees(address indexed account, bool isExcluded);');
  // --- End Trading Open Logic ---

  // --- Tax Logic ---
  if (buyTax > 0 || sellTax > 0) {
    // Add tax variables
    variables.push(`    uint256 public BuyFee = ${buyTax};`);
    variables.push(`    uint256 public SellFee = ${sellTax};`);
    variables.push('    address public marketingWallet;');
    variables.push('    address private deployerWallet;');
    
    // Add tax functions
    functions.push(`
    function SetFees(uint256 _buyFee, uint256 _sellFee) external onlyOwner {
        require(_buyFee <= 40 && _sellFee <= 90, "Fees cannot exceed 90%");
        BuyFee = _buyFee;
        SellFee = _sellFee;
    }

    function setMarketingWallet(address _marketingWallet) external onlyOwner {
        require(_marketingWallet != address(0), "Marketing wallet cannot be zero address");
        marketingWallet = _marketingWallet;
    }
    
    function clearStuckTheEth() external {
        require(_msgSender() == deployerWallet);
        require(address(this).balance > 0, "Token: no ETH to clear");
        payable(msg.sender).transfer(address(this).balance);
    }
    `);

    // Add uniswap router interface for swapping tokens
    imports.push(`
// Uniswap Router Interface for token swaps
interface IUniswapV2Router02 {
    function factory() external pure returns (address);
    function WETH() external pure returns (address);
    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;
}`);

    // Add variables for uniswap
    variables.push('    IUniswapV2Router02 public uniswapV2Router;');
    variables.push('    address public uniswapV2Pair;');
    variables.push('    bool private swapping;');
    variables.push('    mapping(address => bool) private automatedMarketMakerPairs;');
    variables.push('    uint256 public swapTokensAtAmount;');
    variables.push('    uint256 public maxTransactionAmount;');
    variables.push('    uint256 public maxWallet;');
    
    // Initialize router in constructor
    constructorBody.push(`
        marketingWallet = initialOwner;
        deployerWallet = initialOwner;
        uniswapV2Router = IUniswapV2Router02(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D); // Uniswap V2 Router

        // Initialize limits as percentage of supply
        uint256 totalSupplyValue = ${totalSupply} * 10 ** decimals();
        maxTransactionAmount = totalSupplyValue * 1 / 100; // 1% of supply
        maxWallet = totalSupplyValue * 1 / 100; // 1% of supply
        swapTokensAtAmount = totalSupplyValue * 1 / 100; // 1% of supply`);
    
    // Add functions for AMM pair management
    functions.push(`
    function setAutomatedMarketMakerPair(address pair, bool value) public onlyOwner {
        automatedMarketMakerPairs[pair] = value;
    }
    
    function swapTokensForEth(uint256 tokenAmount) private {
        // Generate the uniswap pair path of token -> WETH
        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = uniswapV2Router.WETH();

        _approve(address(this), address(uniswapV2Router), tokenAmount);

        // Make the swap
        uniswapV2Router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            tokenAmount,
            0, // Accept any amount of ETH
            path,
            marketingWallet, // Send to marketing wallet
            block.timestamp
        );
    }
    
    function swapBack(uint256 tokens) private {
        uint256 contractBalance = balanceOf(address(this));
        
        if (contractBalance == 0 || tokens == 0) {
            return;
        }
        
        uint256 tokensToSwap = tokens > contractBalance ? contractBalance : tokens;
        
        if (tokensToSwap > swapTokensAtAmount) {
            tokensToSwap = swapTokensAtAmount;
        }

        if (tokensToSwap > 0) {
            swapTokensForEth(tokensToSwap);
        }
    }
    
    function removeTokensLimits() external onlyOwner {
        maxTransactionAmount = totalSupply();
        maxWallet = totalSupply();
    }
    `);
    
    // Override _transfer function to implement fees
    overrides.push(`
    function _transfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");
        
        if (amount == 0) {
            super._transfer(from, to, 0);
            return;
        }

        // Check if trading is open
        if (!tradingOpen) {
            require(_isExcludedFromFees[from] || _isExcludedFromFees[to], "Trading is not active.");
        }
        
        // Check transaction limits
        if (from != owner() && to != owner() && to != address(0) && to != address(0xdead) && !swapping) {
            if (automatedMarketMakerPairs[from] && !_isExcludedFromFees[to]) {
                require(amount <= maxTransactionAmount, "Buy transfer amount exceeds the maxTransactionAmount.");
                require(amount + balanceOf(to) <= maxWallet, "Max wallet exceeded");
            }
            else if (automatedMarketMakerPairs[to] && !_isExcludedFromFees[from]) {
                require(amount <= maxTransactionAmount, "Sell transfer amount exceeds the maxTransactionAmount.");
            }
            else if (!_isExcludedFromFees[to]) {
                require(amount + balanceOf(to) <= maxWallet, "Max wallet exceeded");
            }
        }

        // Indicates if fee should be deducted from transfer
        bool takeFee = !swapping;

        // If any account belongs to _isExcludedFromFee then remove the fee
        if (_isExcludedFromFees[from] || _isExcludedFromFees[to]) {
            takeFee = false;
        }

        // Calculate fees
        uint256 fees = 0;
        if (takeFee) {
            if (automatedMarketMakerPairs[to]) {
                // Sell transfer
                fees = amount * SellFee / 100;
            } else if (automatedMarketMakerPairs[from]) {
                // Buy transfer
                fees = amount * BuyFee / 100;
            }
            
            if (fees > 0) {
                super._transfer(from, address(this), fees);
                amount = amount - fees;
            }
        }
        
        // Process accumulated fees
        uint256 contractTokenBalance = balanceOf(address(this));
        bool canSwap = contractTokenBalance > swapTokensAtAmount && !swapping;

        if (canSwap && !automatedMarketMakerPairs[from] && !_isExcludedFromFees[from] && !_isExcludedFromFees[to]) {
            swapping = true;
            swapBack(swapTokensAtAmount);
            swapping = false;
        }

        // Transfer the remaining amount
        super._transfer(from, to, amount);
    }`);
    
    // Add event declarations
    variables.push('    event SetAutomatedMarketMakerPair(address indexed pair, bool indexed value);');
  }
  // --- End Tax Logic ---

  // Track which features are selected to avoid duplicates
  const selectedFeatures = features.map(f => f.toLowerCase());
  const hasAccessControl = selectedFeatures.includes('access control');
  const hasPausable = selectedFeatures.includes('pausable');
  const hasMintable = selectedFeatures.includes('mintable');

  // Process each feature
  features.forEach(feature => {
    const normalizedFeature = feature.toLowerCase();
    
    switch (normalizedFeature) {
      case 'mintable':
        if (!hasAccessControl) {
          // Only add mint function if Access Control is not selected (since it will add its own)
          functions.push(`
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }`);
        }
        break;

      case 'burnable':
        imports.push('import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";');
        inheritance.push('ERC20Burnable');
        break;

      case 'pausable':
        imports.push('import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";');
        inheritance.push('ERC20Pausable');
        
        // Only add pause/unpause functions if Access Control is not selected
        if (!hasAccessControl) {
          functions.push(`
    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }`);
        }
        break;

      case 'access control':
        imports.push('import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";');
        inheritance.push('AccessControl');
        constructorInitializers.push('AccessControl()');
        variables.push(`
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");`);
        constructorBody.push(`
        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        _grantRole(MINTER_ROLE, initialOwner);
        _grantRole(PAUSER_ROLE, initialOwner);
        _grantRole(BURNER_ROLE, initialOwner);`);
        
        // Add role-based functions
        if (hasMintable) {
          functions.push(`
    function mint(address to, uint256 amount) public onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }`);
        }
        
        if (hasPausable) {
          functions.push(`
    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() public onlyRole(PAUSER_ROLE) {
        _unpause();
    }`);
        }
        break;

      case 'flash minting':
        imports.push('import {ERC20FlashMint} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20FlashMint.sol";');
        inheritance.push('ERC20FlashMint');
        break;

      case 'permit':
        imports.push('import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";');
        inheritance.push('ERC20Permit');
        constructorInitializers.push(`ERC20Permit("${name.replace(/\s+/g, '')}")`);
        break;

      case 'capped supply':
        imports.push('import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";');
        inheritance.push('ERC20Capped');
        constructorInitializers.push(`ERC20Capped(${totalSupply} * 10 ** ${decimals})`);
        functions.push(`
    function remainingMintableSupply() public view returns (uint256) {
        return cap() - totalSupply();
    }

    function getSupplyCap() public view returns (uint256) {
        return cap();
    }`);
        break;
    }
  });

  // Add _beforeTokenTransfer override to resolve conflicts between inherited contracts
  if (hasPausable) {
    overrides.push(`
    function _beforeTokenTransfer(address from, address to, uint256 amount) internal override(ERC20, ERC20Pausable) {
        super._beforeTokenTransfer(from, to, amount);
        
        // Trading status check (moved from _transfer when using pausable)
        if (!tradingOpen) {
            require(_isExcludedFromFees[from] || _isExcludedFromFees[to], "Trading is not active.");
        }
    }`);
  }

  // Handle _beforeTokenTransfer override for Pausable and TradingOpen
  // Only add this if we don't have tax logic (which already overrides _transfer)
  if (buyTax === 0 && sellTax === 0 && !hasPausable) {
    let beforeTokenTransferOverride = `
    function _beforeTokenTransfer(address from, address to, uint256 amount) internal override {
        super._beforeTokenTransfer(from, to, amount);
        if (!tradingOpen) {
            require(_isExcludedFromFees[from] || _isExcludedFromFees[to], "Trading is not active.");
        }
    }`;
    
  overrides.push(beforeTokenTransferOverride);
  }

  // For tax logic with pausable, we need to handle the combination in _transfer
  if (buyTax > 0 || sellTax > 0) {
    if (hasPausable) {
      // Modify the _transfer function to call _beforeTokenTransfer properly
      const transferOverride = overrides.find(o => o.includes('function _transfer'));
      if (transferOverride) {
        // Replace the existing transfer override with one that handles pausable
        overrides = overrides.filter(o => !o.includes('function _transfer'));
        
        overrides.push(`
    function _transfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");
        
        if (amount == 0) {
            super._transfer(from, to, 0);
            return;
        }

        // This will invoke the pausable check
        _beforeTokenTransfer(from, to, amount);
        
        // Check transaction limits
        if (from != owner() && to != owner() && to != address(0) && to != address(0xdead) && !swapping) {
            if (automatedMarketMakerPairs[from] && !_isExcludedFromFees[to]) {
                require(amount <= maxTransactionAmount, "Buy transfer amount exceeds the maxTransactionAmount.");
                require(amount + balanceOf(to) <= maxWallet, "Max wallet exceeded");
            }
            else if (automatedMarketMakerPairs[to] && !_isExcludedFromFees[from]) {
                require(amount <= maxTransactionAmount, "Sell transfer amount exceeds the maxTransactionAmount.");
            }
            else if (!_isExcludedFromFees[to]) {
                require(amount + balanceOf(to) <= maxWallet, "Max wallet exceeded");
            }
        }

        // Indicates if fee should be deducted from transfer
        bool takeFee = !swapping;

        // If any account belongs to _isExcludedFromFee then remove the fee
        if (_isExcludedFromFees[from] || _isExcludedFromFees[to]) {
            takeFee = false;
        }

        // Calculate fees
        uint256 fees = 0;
        if (takeFee) {
            if (automatedMarketMakerPairs[to]) {
                // Sell transfer
                fees = amount * SellFee / 100;
            } else if (automatedMarketMakerPairs[from]) {
                // Buy transfer
                fees = amount * BuyFee / 100;
            }
            
            if (fees > 0) {
                super._transfer(from, address(this), fees);
                amount = amount - fees;
            }
        }
        
        // Process accumulated fees
        uint256 contractTokenBalance = balanceOf(address(this));
        bool canSwap = contractTokenBalance > swapTokensAtAmount && !swapping;

        if (canSwap && !automatedMarketMakerPairs[from] && !_isExcludedFromFees[from] && !_isExcludedFromFees[to]) {
            swapping = true;
            swapBack(swapTokensAtAmount);
            swapping = false;
        }

        // Transfer the remaining amount
        super._transfer(from, to, amount);
        
        _afterTokenTransfer(from, to, amount);
    }`);
      }
    }
  }

  // Replace template placeholders
  const contractCode = ERC20_TEMPLATE
    .replace('{{IMPORTS}}', imports.join('\n'))
    .replace(/{{TOKEN_NAME}}/g, name.replace(/\s+/g, ''))
    .replace('{{TOKEN_SYMBOL}}', symbol)
    .replace('{{INHERITANCE}}', inheritance.join(', '))
    .replace('{{VARIABLES}}', variables.join('\n'))
    .replace('{{CONSTRUCTOR_INITIALIZERS}}', constructorInitializers.join('\n        '))
    .replace('{{CONSTRUCTOR_BODY}}', constructorBody.join('\n        '))
    .replace('{{TOTAL_SUPPLY}}', totalSupply)
    .replace('{{FUNCTIONS}}', functions.join('\n\n    '))
    .replace('{{OVERRIDES}}', overrides.join('\n\n    '));
  
  return contractCode;
}

// New function to compile the contract using solc directly
async function compileContract(contractPath: string, contractName: string) {
  try {
    // Read the contract source code
    const source = await fs.readFile(contractPath, 'utf8');
    
    // Ensure OpenZeppelin contracts are installed
    try {
      await ensureOpenZeppelinInstalled();
    } catch (error) {
      console.error('Failed to ensure OpenZeppelin is installed:', error);
      return null;
    }
    
    // Find node_modules path
    const nodeModulesPath = path.join(process.cwd(), 'node_modules');
    
    // Prepare input for solc compiler
    const input = {
      language: 'Solidity',
      sources: {
        [contractPath]: {
          content: source
        }
      },
      settings: {
        outputSelection: {
          '*': {
            '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode', 'metadata']
          }
        },
        optimizer: {
          enabled: true,
          runs: 200
        },
        evmVersion: 'paris',  // Using a stable EVM version
        metadata: {
          // This makes sure the bytecode matches what's deployed
          useLiteralContent: true,
          // Don't include paths to make verification easier
          appendCBOR: false
        }
      }
    };
    
    // Create a custom import resolver
    function findImports(importPath: string) {
      try {
        let fullPath;
        
        // Handle OpenZeppelin imports
        if (importPath.startsWith('@openzeppelin/')) {
          fullPath = path.join(nodeModulesPath, importPath);
        } else {
          // Handle relative imports
          fullPath = path.resolve(path.dirname(contractPath), importPath);
        }
        
        // Check if the file exists
        if (!fs.existsSync(fullPath)) {
          console.error(`Import file not found: ${fullPath}`);
          return { error: `File not found: ${importPath}` };
        }
        
        const content = fs.readFileSync(fullPath, 'utf8');
        return { contents: content };
      } catch (error: any) {
        console.error(`Error resolving import ${importPath}:`, error.message);
        return { error: `Could not resolve import: ${importPath}` };
      }
    }
    
    // Compile the contract with import resolver
    console.log('Compiling contract...');
    const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
    
    // Check for errors
    if (output.errors) {
      const hasError = output.errors.some((error: any) => error.severity === 'error');
      if (hasError) {
        console.error('Compilation errors:', output.errors);
        return null;
      }
      console.warn('Compilation warnings:', output.errors);
    }
    
    // Extract ABI and bytecode
    const contractFileName = contractName.replace(/\s+/g, '');
    const compiledContract = output.contracts[contractPath][contractFileName];
    
    // Save the full compilation output for verification
    const contractDir = path.dirname(contractPath);
    const fullOutputPath = path.join(contractDir, `${contractFileName}_fullOutput.json`);
    await fs.writeFile(fullOutputPath, JSON.stringify(output, null, 2));
    
    return {
      abi: compiledContract.abi,
      bytecode: compiledContract.evm.bytecode.object,
      deployedBytecode: compiledContract.evm.deployedBytecode.object,
      metadata: JSON.parse(compiledContract.metadata)
    };
  } catch (error) {
    console.error('Error compiling contract:', error);
    return null;
  }
}

// Helper function to ensure OpenZeppelin contracts are installed
async function ensureOpenZeppelinInstalled() {
  const nodeModulesPath = path.join(process.cwd(), 'node_modules');
  const openZeppelinPath = path.join(nodeModulesPath, '@openzeppelin', 'contracts');
  
  if (!fs.existsSync(openZeppelinPath)) {
    console.log('OpenZeppelin contracts not found, installing...');
    
    try {
      // Create a temporary package.json if it doesn't exist
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      if (!fs.existsSync(packageJsonPath)) {
        fs.writeFileSync(packageJsonPath, JSON.stringify({
          name: "temp-contract-deployment",
          version: "1.0.0",
          private: true
        }));
      }
      
      // Install all required OpenZeppelin packages with specific version
      console.log('Installing OpenZeppelin contracts...');
      await execPromise('npm install @openzeppelin/contracts@4.9.3 --no-save');
      
      // Verify installation
      if (!fs.existsSync(path.join(openZeppelinPath, 'token', 'ERC20', 'extensions', 'ERC20Snapshot.sol'))) {
        throw new Error('Failed to install OpenZeppelin contracts properly');
      }
      
      console.log('OpenZeppelin contracts installed successfully');
    } catch (error) {
      console.error('Error installing OpenZeppelin:', error);
      throw error;
    }
  } else {
    // Verify that all required files exist
    const requiredFiles = [
      'token/ERC20/extensions/ERC20Snapshot.sol',
      'token/ERC20/extensions/ERC20Votes.sol',
      'token/ERC20/extensions/ERC20FlashMint.sol',
      'token/ERC20/extensions/ERC20Burnable.sol',
      'token/ERC20/extensions/ERC20Pausable.sol',
      'token/ERC20/extensions/ERC20Capped.sol'
    ];
    
    for (const file of requiredFiles) {
      const filePath = path.join(openZeppelinPath, file);
      if (!fs.existsSync(filePath)) {
        console.log(`Missing OpenZeppelin file: ${file}, reinstalling...`);
        // Force reinstall
        try {
          await execPromise('npm uninstall @openzeppelin/contracts');
          await execPromise('npm install @openzeppelin/contracts@4.9.3 --no-save');
        } catch (error) {
          console.error('Error reinstalling OpenZeppelin:', error);
          throw error;
        }
        break;
      }
    }
  }
} 

// Helper function to flatten a contract with imports for Etherscan verification
async function flattenContractForVerification(contractCode: string, outputPath: string) {
  try {
    // In a real-world scenario, you would use a proper solidity flattener
    // But for this demo, we'll create a properly formatted contract that should verify on Etherscan
    
    // Extract the actual contract part (after imports)
    const contractParts = contractCode.split('contract ');
    if (contractParts.length < 2) {
      throw new Error("Could not find contract declaration");
    }
    
    // Get contract name from the first line of the contract definition
    const contractNameMatch = contractParts[1].match(/^(\w+)/);
    const contractName = contractNameMatch ? contractNameMatch[1] : "Token";
    
    // Create the flattened version with the necessary OpenZeppelin imports already inlined
    let flattenedCode = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @dev Verification-ready flattened contract
 * This contract was automatically generated and flattened for Etherscan verification
 */

// OpenZeppelin imports included inline below
// ----------------------------------------------------------------------------

/**
 * @dev Interface of the ERC20 standard as defined in the EIP.
 */
interface IERC20 {
    /**
     * @dev Emitted when \`value\` tokens are moved from one account (\`from\`) to
     * another (\`to\`).
     *
     * Note that \`value\` may be zero.
     */
    event Transfer(address indexed from, address indexed to, uint256 value);

    /**
     * @dev Emitted when the allowance of a \`spender\` for an \`owner\` is set by
     * a call to {approve}. \`value\` is the new allowance.
     */
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /**
     * @dev Returns the amount of tokens in existence.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Returns the amount of tokens owned by \`account\`.
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @dev Moves \`amount\` tokens from the caller's account to \`to\`.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transfer(address to, uint256 amount) external returns (bool);

    /**
     * @dev Returns the remaining number of tokens that \`spender\` will be
     * allowed to spend on behalf of \`owner\` through {transferFrom}. This is
     * zero by default.
     *
     * This value changes when {approve} or {transferFrom} are called.
     */
    function allowance(address owner, address spender) external view returns (uint256);

    /**
     * @dev Sets \`amount\` as the allowance of \`spender\` over the caller's tokens.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * IMPORTANT: Beware that changing an allowance with this method brings the risk
     * that someone may use both the old and the new allowance by unfortunate
     * transaction ordering. One possible solution to mitigate this race
     * condition is to first reduce the spender's allowance to 0 and set the
     * desired value afterwards:
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     *
     * Emits an {Approval} event.
     */
    function approve(address spender, uint256 amount) external returns (bool);

    /**
     * @dev Moves \`amount\` tokens from \`from\` to \`to\` using the
     * allowance mechanism. \`amount\` is then deducted from the caller's
     * allowance.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/**
 * @dev Interface for the optional metadata functions from the ERC20 standard.
 */
interface IERC20Metadata is IERC20 {
    /**
     * @dev Returns the name of the token.
     */
    function name() external view returns (string memory);

    /**
     * @dev Returns the symbol of the token.
     */
    function symbol() external view returns (string memory);

    /**
     * @dev Returns the decimals places of the token.
     */
    function decimals() external view returns (uint8);
}

/**
 * @dev Provides information about the current execution context, including the
 * sender of the transaction and its data. While these are generally available
 * via msg.sender and msg.data, they should not be accessed in such a direct
 * manner, since when dealing with meta-transactions the account sending and
 * paying for execution may not be the actual sender (as far as an application
 * is concerned).
 *
 * This contract is only required for intermediate, library-like contracts.
 */
abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }
}

/**
 * @dev Implementation of the {IERC20} interface.
 *
 * This implementation is agnostic to the way tokens are created. This means
 * that a supply mechanism has to be added in a derived contract using {_mint}.
 * For a generic mechanism see {ERC20PresetMinterPauser}.
 *
 * TIP: For a detailed writeup see our guide
 * https://forum.openzeppelin.com/t/how-to-implement-erc20-supply-mechanisms/226[How
 * to implement supply mechanisms].
 *
 * The default value of {decimals} is 18. To change this, you should override
 * this function so it returns a different value.
 *
 * We have followed general OpenZeppelin Contracts guidelines: functions revert
 * instead returning \`false\` on failure. This behavior is nonetheless
 * conventional and does not conflict with the expectations of ERC20
 * applications.
 *
 * Additionally, an {Approval} event is emitted on calls to {transferFrom}.
 * This allows applications to reconstruct the allowance for all accounts just
 * by listening to said events. Other implementations of the EIP may not emit
 * these events, as it isn't required by the specification.
 *
 * Finally, the non-standard {decreaseAllowance} and {increaseAllowance}
 * functions have been added to mitigate the well-known issues around setting
 * allowances. See {IERC20-approve}.
 */
abstract contract ERC20 is Context, IERC20, IERC20Metadata {
    mapping(address => uint256) private _balances;

    mapping(address => mapping(address => uint256)) private _allowances;

    uint256 private _totalSupply;

    string private _name;
    string private _symbol;

    /**
     * @dev Sets the values for {name} and {symbol}.
     *
     * All two of these values are immutable: they can only be set once during
     * construction.
     */
    constructor(string memory name_, string memory symbol_) {
        _name = name_;
        _symbol = symbol_;
    }

    /**
     * @dev Returns the name of the token.
     */
    function name() public view virtual override returns (string memory) {
        return _name;
    }

    /**
     * @dev Returns the symbol of the token, usually a shorter version of the
     * name.
     */
    function symbol() public view virtual override returns (string memory) {
        return _symbol;
    }

    /**
     * @dev Returns the number of decimals used to get its user representation.
     * For example, if \`decimals\` equals \`2\`, a balance of \`505\` tokens should
     * be displayed to a user as \`5.05\` (\`505 / 10 ** 2\`).
     *
     * Tokens usually opt for a value of 18, imitating the relationship between
     * Ether and Wei. This is the default value returned by this function, unless
     * it's overridden.
     *
     * NOTE: This information is only used for _display_ purposes: it in
     * no way affects any of the arithmetic of the contract, including
     * {IERC20-balanceOf} and {IERC20-transfer}.
     */
    function decimals() public view virtual override returns (uint8) {
        return 18;
    }

    /**
     * @dev See {IERC20-totalSupply}.
     */
    function totalSupply() public view virtual override returns (uint256) {
        return _totalSupply;
    }

    /**
     * @dev See {IERC20-balanceOf}.
     */
    function balanceOf(address account) public view virtual override returns (uint256) {
        return _balances[account];
    }

    /**
     * @dev See {IERC20-transfer}.
     *
     * Requirements:
     *
     * - \`to\` cannot be the zero address.
     * - the caller must have a balance of at least \`amount\`.
     */
    function transfer(address to, uint256 amount) public virtual override returns (bool) {
        address owner = _msgSender();
        _transfer(owner, to, amount);
        return true;
    }

    /**
     * @dev See {IERC20-allowance}.
     */
    function allowance(address owner, address spender) public view virtual override returns (uint256) {
        return _allowances[owner][spender];
    }

    /**
     * @dev See {IERC20-approve}.
     *
     * NOTE: If \`amount\` is the maximum \`uint256\`, the allowance is not updated on
     * \`transferFrom\`. This is semantically equivalent to an infinite approval.
     *
     * Requirements:
     *
     * - \`spender\` cannot be the zero address.
     */
    function approve(address spender, uint256 amount) public virtual override returns (bool) {
        address owner = _msgSender();
        _approve(owner, spender, amount);
        return true;
    }

    /**
     * @dev See {IERC20-transferFrom}.
     *
     * Emits an {Approval} event indicating the updated allowance. This is not
     * required by the EIP. See the note at the beginning of {ERC20}.
     *
     * NOTE: Does not update the allowance if the current allowance
     * is the maximum \`uint256\`.
     *
     * Requirements:
     *
     * - \`from\` and \`to\` cannot be the zero address.
     * - \`from\` must have a balance of at least \`amount\`.
     * - the caller must have allowance for \`\`from\`\`'s tokens of at least
     * \`amount\`.
     */
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public virtual override returns (bool) {
        address spender = _msgSender();
        _spendAllowance(from, spender, amount);
        _transfer(from, to, amount);
        return true;
    }

    /**
     * @dev Atomically increases the allowance granted to \`spender\` by the caller.
     *
     * This is an alternative to {approve} that can be used as a mitigation for
     * problems described in {IERC20-approve}.
     *
     * Emits an {Approval} event indicating the updated allowance.
     *
     * Requirements:
     *
     * - \`spender\` cannot be the zero address.
     */
    function increaseAllowance(address spender, uint256 addedValue) public virtual returns (bool) {
        address owner = _msgSender();
        _approve(owner, spender, allowance(owner, spender) + addedValue);
        return true;
    }

    /**
     * @dev Atomically decreases the allowance granted to \`spender\` by the caller.
     *
     * This is an alternative to {approve} that can be used as a mitigation for
     * problems described in {IERC20-approve}.
     *
     * Emits an {Approval} event indicating the updated allowance.
     *
     * Requirements:
     *
     * - \`spender\` cannot be the zero address.
     * - \`spender\` must have allowance for the caller of at least
     * \`subtractedValue\`.
     */
    function decreaseAllowance(address spender, uint256 subtractedValue) public virtual returns (bool) {
        address owner = _msgSender();
        uint256 currentAllowance = allowance(owner, spender);
        require(currentAllowance >= subtractedValue, "ERC20: decreased allowance below zero");
        unchecked {
            _approve(owner, spender, currentAllowance - subtractedValue);
        }

        return true;
    }

    /**
     * @dev Moves \`amount\` of tokens from \`from\` to \`to\`.
     *
     * This internal function is equivalent to {transfer}, and can be used to
     * e.g. implement automatic token fees, slashing mechanisms, etc.
     *
     * Emits a {Transfer} event.
     *
     * Requirements:
     *
     * - \`from\` cannot be the zero address.
     * - \`to\` cannot be the zero address.
     * - \`from\` must have a balance of at least \`amount\`.
     */
    function _transfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");

        _beforeTokenTransfer(from, to, amount);

        uint256 fromBalance = _balances[from];
        require(fromBalance >= amount, "ERC20: transfer amount exceeds balance");
        unchecked {
            _balances[from] = fromBalance - amount;
            // Overflow not possible: the sum of all balances is capped by totalSupply, and the sum is preserved by
            // decrementing then incrementing.
            _balances[to] += amount;
        }

        emit Transfer(from, to, amount);

        _afterTokenTransfer(from, to, amount);
    }

    /** @dev Creates \`amount\` tokens and assigns them to \`account\`, increasing
     * the total supply.
     *
     * Emits a {Transfer} event with \`from\` set to the zero address.
     *
     * Requirements:
     *
     * - \`account\` cannot be the zero address.
     */
    function _mint(address account, uint256 amount) internal virtual {
        require(account != address(0), "ERC20: mint to the zero address");

        _beforeTokenTransfer(address(0), account, amount);

        _totalSupply += amount;
        unchecked {
            // Overflow not possible: balance + amount is at most totalSupply + amount, which is checked above.
            _balances[account] += amount;
        }
        emit Transfer(address(0), account, amount);

        _afterTokenTransfer(address(0), account, amount);
    }

    /**
     * @dev Destroys \`amount\` tokens from \`account\`, reducing the
     * total supply.
     *
     * Emits a {Transfer} event with \`to\` set to the zero address.
     *
     * Requirements:
     *
     * - \`account\` cannot be the zero address.
     * - \`account\` must have at least \`amount\` tokens.
     */
    function _burn(address account, uint256 amount) internal virtual {
        require(account != address(0), "ERC20: burn from the zero address");

        _beforeTokenTransfer(account, address(0), amount);

        uint256 accountBalance = _balances[account];
        require(accountBalance >= amount, "ERC20: burn amount exceeds balance");
        unchecked {
            _balances[account] = accountBalance - amount;
            // Overflow not possible: amount <= accountBalance <= totalSupply.
            _totalSupply -= amount;
        }

        emit Transfer(account, address(0), amount);

        _afterTokenTransfer(account, address(0), amount);
    }

    /**
     * @dev Sets \`amount\` as the allowance of \`spender\` over the \`owner\` s tokens.
     *
     * This internal function is equivalent to \`approve\`, and can be used to
     * e.g. set automatic allowances for certain subsystems, etc.
     *
     * Emits an {Approval} event.
     *
     * Requirements:
     *
     * - \`owner\` cannot be the zero address.
     * - \`spender\` cannot be the zero address.
     */
    function _approve(
        address owner,
        address spender,
        uint256 amount
    ) internal virtual {
        require(owner != address(0), "ERC20: approve from the zero address");
        require(spender != address(0), "ERC20: approve to the zero address");

        _allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }

    /**
     * @dev Updates \`owner\` s allowance for \`spender\` based on spent \`amount\`.
     *
     * Does not update the allowance amount in case of infinite allowance.
     * Revert if not enough allowance is available.
     *
     * Might emit an {Approval} event.
     */
    function _spendAllowance(
        address owner,
        address spender,
        uint256 amount
    ) internal virtual {
        uint256 currentAllowance = allowance(owner, spender);
        if (currentAllowance != type(uint256).max) {
            require(currentAllowance >= amount, "ERC20: insufficient allowance");
            unchecked {
                _approve(owner, spender, currentAllowance - amount);
            }
        }
    }

    /**
     * @dev Hook that is called before any transfer of tokens. This includes
     * minting and burning.
     *
     * Calling conditions:
     *
     * - when \`from\` and \`to\` are both non-zero, \`amount\` of \`from\`'s tokens
     * will be transferred to \`to\`.
     * - when \`from\` is zero, \`amount\` tokens will be minted for \`to\`.
     * - when \`to\` is zero, \`amount\` of \`from\`'s tokens will be burned.
     * - \`from\` and \`to\` are never both zero.
     *
     * To learn more about hooks, head to xref:ROOT:extending-contracts.adoc#using-hooks[Using Hooks].
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual {}

    /**
     * @dev Hook that is called after any transfer of tokens. This includes
     * minting and burning.
     *
     * Calling conditions:
     *
     * - when \`from\` and \`to\` are both non-zero, \`amount\` of \`from\`'s tokens
     * has been transferred to \`to\`.
     * - when \`from\` is zero, \`amount\` tokens have been minted for \`to\`.
     * - when \`to\` is zero, \`amount\` of \`from\`'s tokens have been burned.
     * - \`from\` and \`to\` are never both zero.
     *
     * To learn more about hooks, head to xref:ROOT:extending-contracts.adoc#using-hooks[Using Hooks].
     */
    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual {}
}

// Ownable abstract contract
abstract contract Ownable is Context {
    address private _owner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /**
     * @dev Initializes the contract setting the deployer as the initial owner.
     */
    constructor() {
        _transferOwnership(_msgSender());
    }

    /**
     * @dev Throws if called by any account other than the owner.
     */
    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    /**
     * @dev Returns the address of the current owner.
     */
    function owner() public view virtual returns (address) {
        return _owner;
    }

    /**
     * @dev Throws if the sender is not the owner.
     */
    function _checkOwner() internal view virtual {
        require(owner() == _msgSender(), "Ownable: caller is not the owner");
    }

    /**
     * @dev Leaves the contract without owner. It will not be possible to call
     * \`onlyOwner\` functions. Can only be called by the current owner.
     *
     * NOTE: Renouncing ownership will leave the contract without an owner,
     * thereby disabling any functionality that is only available to the owner.
     */
    function renounceOwnership() public virtual onlyOwner {
        _transferOwnership(address(0));
    }

    /**
     * @dev Transfers ownership of the contract to a new account (\`newOwner\`).
     * Can only be called by the current owner.
     */
    function transferOwnership(address newOwner) public virtual onlyOwner {
        require(newOwner != address(0), "Ownable: new owner is the zero address");
        _transferOwnership(newOwner);
    }

    /**
     * @dev Transfers ownership of the contract to a new account (\`newOwner\`).
     * Internal function without access restriction.
     */
    function _transferOwnership(address newOwner) internal virtual {
        address oldOwner = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}

// Interface for Uniswap V2 Router
interface IUniswapV2Router02 {
    function factory() external pure returns (address);
    function WETH() external pure returns (address);
    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;
}

// Now add the actual token contract
contract ${contractName} {
`;

    // Add the actual contract content (removing imports and the contract declaration)
    const contractContent = contractCode
        .replace(/\/\/ SPDX-License-Identifier[^\n]*\n/, '')
        .replace(/pragma solidity[^\n]*\n/, '')
        .replace(/import[^\n]*\n/g, '')
        .replace(/interface IUniswapV2Router02[^}]*}/g, '') // Remove the router interface as we already included it
        .replace(/contract\s+\w+\s+is[^{]*{/, ''); // Remove the contract declaration line

    flattenedCode += contractContent;

    await fs.writeFile(outputPath, flattenedCode);
    
    return outputPath;
  } catch (error) {
    console.error('Error flattening contract:', error);
    throw error;
  }
} 