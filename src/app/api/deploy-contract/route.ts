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
    
    const { abi, bytecode } = compilationOutput;
    
    return NextResponse.json({
      contractCode,
      abi,
      bytecode,
      logoUrl: contractDetails.logoUrl
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
            '*': ['abi', 'evm.bytecode']
          }
        },
        optimizer: {
          enabled: true,
          runs: 200
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
    
    return {
      abi: compiledContract.abi,
      bytecode: compiledContract.evm.bytecode.object
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