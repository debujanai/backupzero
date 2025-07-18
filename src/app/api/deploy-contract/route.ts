import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs-extra';
import solc from 'solc';
import { promisify } from 'util';
import { exec } from 'child_process';

// Convert exec to Promise-based
const execPromise = promisify(exec);

// Basic ERC20 token template
const ERC20_TEMPLATE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
{{IMPORTS}}

contract {{TOKEN_NAME}} is ERC20{{INHERITANCE}} {
    {{VARIABLES}}
    
    constructor(address initialOwner) ERC20("{{TOKEN_NAME}}", "{{TOKEN_SYMBOL}}") {{CONSTRUCTOR_MODIFIERS}} {
        {{CONSTRUCTOR_BODY}}
        _mint(initialOwner, {{TOTAL_SUPPLY}} * 10 ** decimals());
    }
    
    {{FUNCTIONS}}
}`;

// Function to handle contract deployment logic
export async function POST(request: Request) {
  try {
    const { contractDetails } = await request.json();
    
    // Extract contract details
    const { name, symbol, decimals, totalSupply, features } = contractDetails;
    
    if (!name || !symbol || !totalSupply) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400
      });
    }

    console.log('Generating contract with:', { name, symbol, decimals, totalSupply, features });
    
    // Generate contract code
    const contractCode = generateContractCode(name, symbol, decimals, totalSupply, features);
    
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
  features: string[]
) {
  // Initialize imports, inheritance, variables, constructor modifiers and functions
  let imports = '';
  let inheritance = '';
  let variables = '';
  let constructorModifiers = '';
  let constructorBody = '';
  let functions = '';
  
  // Add Ownable if any feature requires it
  if (features.includes('Mintable') || features.includes('Pausable') || features.includes('Flash Minting')) {
    if (!features.includes('Access Control')) {
      imports += '\nimport "@openzeppelin/contracts/access/Ownable.sol";';
      inheritance += ', Ownable';
      constructorModifiers += 'Ownable(initialOwner)';
    }
  }
  
  // Add features based on selection
  if (features.includes('Mintable')) {
    functions += `
    /**
     * @dev Creates new tokens and assigns them to the specified address.
     * @param to The address that will receive the minted tokens
     * @param amount The amount of tokens to mint
     */
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }`;
  }
  
  if (features.includes('Burnable')) {
    imports += '\nimport "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";';
    inheritance += ', ERC20Burnable';
    
    // Add a custom burn function with a reason parameter
    functions += `
    /**
     * @dev Burns tokens from the caller's account with a reason.
     * @param amount The amount of tokens to burn
     * @param reason The reason for burning tokens
     */
    function burnWithReason(uint256 amount, string memory reason) public {
        burn(amount);
        emit TokensBurned(msg.sender, amount, reason);
    }
    
    // Event emitted when tokens are burned with a reason
    event TokensBurned(address indexed burner, uint256 amount, string reason);`;
  }
  
  if (features.includes('Pausable')) {
    imports += '\nimport "@openzeppelin/contracts/security/Pausable.sol";';
    inheritance += ', Pausable';
    
    functions += `
    /**
     * @dev Pauses all token transfers.
     */
    function pause() public onlyOwner {
        _pause();
    }

    /**
     * @dev Unpauses all token transfers.
     */
    function unpause() public onlyOwner {
        _unpause();
    }
    
    /**
     * @dev Returns the current pause status of the contract.
     */
    function isPaused() public view returns (bool) {
        return paused();
    }`;
  }
  
  if (features.includes('Capped Supply')) {
    imports += '\nimport "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";';
    inheritance += ', ERC20Capped';
    constructorModifiers += ` ERC20Capped(${totalSupply} * 10 ** ${decimals})`;
    
    // Add a function to check remaining mintable tokens
    functions += `
    /**
     * @dev Returns the amount of tokens that can still be minted.
     */
    function remainingMintableSupply() public view returns (uint256) {
        return cap() - totalSupply();
    }
    
    /**
     * @dev Returns the cap on the token's total supply.
     */
    function getSupplyCap() public view returns (uint256) {
        return cap();
    }`;
  }
  
  if (features.includes('Access Control')) {
    imports += '\nimport "@openzeppelin/contracts/access/AccessControl.sol";';
    inheritance = inheritance.replace(', Ownable', ''); // Replace Ownable with AccessControl
    inheritance += ', AccessControl';
    
    variables += `
    // Create a new role identifier for the minter role
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");`;
    
    constructorBody += `
        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        _grantRole(MINTER_ROLE, initialOwner);
        _grantRole(PAUSER_ROLE, initialOwner);
        _grantRole(BURNER_ROLE, initialOwner);`;
    
    // Update functions to use roles instead of onlyOwner
    if (features.includes('Mintable')) {
      functions = functions.replace('onlyOwner', 'onlyRole(MINTER_ROLE)');
    }
    
    if (features.includes('Pausable')) {
      functions = functions.replace(/onlyOwner/g, 'onlyRole(PAUSER_ROLE)');
    }
    
    // Add role management functions
    functions += `
    /**
     * @dev Grants a role to an account.
     * @param role The role being granted
     * @param account The account receiving the role
     */
    function grantRole(bytes32 role, address account) public override onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(role, account);
    }
    
    /**
     * @dev Revokes a role from an account.
     * @param role The role being revoked
     * @param account The account losing the role
     */
    function revokeRole(bytes32 role, address account) public override onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(role, account);
    }`;
  }
  
  // Add Votes feature
  if (features.includes('Votes')) {
    imports += '\nimport "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";';
    inheritance += ', ERC20Votes';
    constructorModifiers += ' ERC20Permit("' + name.replace(/\s+/g, '') + '")';
    
    functions += `
    /**
     * @dev Override _afterTokenTransfer to handle ERC20Votes
     */
    function _afterTokenTransfer(address from, address to, uint256 amount) internal override(ERC20, ERC20Votes) {
        super._afterTokenTransfer(from, to, amount);
    }`;
  }
  
  // Add Flash Minting feature
  if (features.includes('Flash Minting')) {
    imports += '\nimport "@openzeppelin/contracts/token/ERC20/extensions/ERC20FlashMint.sol";';
    inheritance += ', ERC20FlashMint';
    
    functions += `
    /**
     * @dev Returns the maximum flash loan amount for a token.
     */
    function maxFlashLoan(address token) public view override returns (uint256) {
        return token == address(this) ? type(uint256).max - totalSupply() : 0;
    }
    
    /**
     * @dev Returns the flash loan fee for a token.
     */
    function flashFee(address token, uint256 amount) public view override returns (uint256) {
        require(token == address(this), "ERC20FlashMint: wrong token");
        return amount * 3 / 1000; // 0.3% fee
    }`;
  }
  
  // Handle _beforeTokenTransfer override for Pausable
  if (features.includes('Pausable')) {
    // Only add _beforeTokenTransfer if no other feature overrides it
    if (!features.includes('Snapshot') && !features.includes('Votes')) {
      functions += `
    /**
     * @dev Hook that is called before any transfer of tokens.
     */
    function _beforeTokenTransfer(address from, address to, uint256 amount) internal override whenNotPaused {
        super._beforeTokenTransfer(from, to, amount);
    }`;
    }
  }
  
  // Handle _mint override for multiple features
  if (features.includes('Votes')) {
    const mintOverrides = ['ERC20', 'ERC20Votes'];
    if (features.includes('Capped Supply')) {
      mintOverrides.push('ERC20Capped');
    }
    
    functions += `
    /**
     * @dev Override _mint to handle multiple inheritance
     */
    function _mint(address to, uint256 amount) internal override(${mintOverrides.join(', ')}) {
        super._mint(to, amount);
    }
    
    /**
     * @dev Override _burn to handle ERC20Votes
     */
    function _burn(address account, uint256 amount) internal override(ERC20, ERC20Votes) {
        super._burn(account, amount);
    }`;
  }
  
  // Update all onlyOwner modifiers if Access Control is selected
  if (features.includes('Access Control')) {
    // Replace all onlyOwner modifiers with appropriate role checks
    functions = functions.replace(/onlyOwner/g, 'onlyRole(DEFAULT_ADMIN_ROLE)');
  }
  
  // Apply mintable tax feature
  if (features.includes('Mintable Tax')) {
    const taxRate = 0.05; // 5% tax
    imports += '\nimport "@openzeppelin/contracts/utils/math/SafeMath.sol";';
    variables += '\n    using SafeMath for uint256;\n';
    variables += `\n    address public taxWallet;\n    uint256 public taxRate = ${taxRate * 10000}; // ${taxRate * 100}% tax in basis points\n`;
    
    if (!features.includes('Access Control')) {
      constructorBody += '\n        taxWallet = initialOwner;';
    } else {
      constructorBody += '\n        taxWallet = initialOwner;\n        _setupRole(DEFAULT_ADMIN_ROLE, initialOwner);';
    }
    
    // Add minting with tax logic
    functions += `
    /**
     * @dev Creates new tokens and applies tax.
     * @param to The address that will receive the minted tokens
     * @param amount The amount of tokens to mint
     */
    function mint(address to, uint256 amount) public onlyOwner {
        // Calculate the tax amount
        uint256 taxAmount = amount.mul(taxRate).div(10000);
        uint256 afterTaxAmount = amount.sub(taxAmount);
        
        // Mint tokens to recipient
        _mint(to, afterTaxAmount);
        
        // Mint tax to the tax wallet
        if (taxAmount > 0) {
            _mint(taxWallet, taxAmount);
        }
    }
    
    /**
     * @dev Updates the tax rate.
     * @param newTaxRate The new tax rate in basis points (1% = 100)
     */
    function setTaxRate(uint256 newTaxRate) public onlyOwner {
        require(newTaxRate <= 2000, "Tax cannot exceed 20%");
        taxRate = newTaxRate;
    }
    
    /**
     * @dev Updates the tax wallet address.
     * @param newTaxWallet The new tax wallet address
     */
    function setTaxWallet(address newTaxWallet) public onlyOwner {
        require(newTaxWallet != address(0), "New tax wallet cannot be zero address");
        taxWallet = newTaxWallet;
    }`;
    
    // Define mint overrides for tax transfers
    const mintOverrides = `
    function _mint(address account, uint256 amount) internal override {
        super._mint(account, amount);
    }`;
    
    functions += mintOverrides;
  }

  // Add mintable feature if not already added via tax
  if (features.includes('Mintable') && !features.includes('Mintable Tax')) {
    functions += `
    /**
     * @dev Creates new tokens and assigns them to the specified address.
     * @param to The address that will receive the minted tokens
     * @param amount The amount of tokens to mint
     */
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }`;
  }

  // Add burnable feature
  if (features.includes('Burnable')) {
    imports += '\nimport "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";';
    inheritance += ', ERC20Burnable';
  }
  
  // Replace template placeholders
  const contractCode = ERC20_TEMPLATE
    .replace('{{IMPORTS}}', imports)
    .replace(/{{TOKEN_NAME}}/g, name.replace(/\s+/g, ''))
    .replace('{{TOKEN_SYMBOL}}', symbol)
    .replace('{{INHERITANCE}}', inheritance)
    .replace('{{VARIABLES}}', variables)
    .replace('{{CONSTRUCTOR_MODIFIERS}}', constructorModifiers)
    .replace('{{CONSTRUCTOR_BODY}}', constructorBody)
    .replace('{{TOTAL_SUPPLY}}', totalSupply)
    .replace('{{FUNCTIONS}}', functions);
  
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