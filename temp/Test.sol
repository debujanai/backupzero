// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

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
}
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC20FlashMint} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20FlashMint.sol";

contract TEST is ERC20, Ownable, ERC20Burnable, AccessControl, ERC20FlashMint {
        bool public tradingOpen = false;
    mapping(address => bool) private _isExcludedFromFees;
    uint256 public buyTax = 1;
    uint256 public sellTax = 3;
    address public marketingWallet;
    IUniswapV2Router02 public uniswapV2Router;
    address public uniswapV2Pair;
    bool private swapping;
    mapping(address => bool) private automatedMarketMakerPairs;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    
    constructor(address initialOwner)
        ERC20("TEST", "TOKEN")
        Ownable()
        AccessControl()
    {
        
        _transferOwnership(initialOwner);
                _isExcludedFromFees[initialOwner] = true;
        
        marketingWallet = initialOwner;
        uniswapV2Router = IUniswapV2Router02(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D); // Uniswap V2 Router
        
        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        _grantRole(MINTER_ROLE, initialOwner);
        _grantRole(PAUSER_ROLE, initialOwner);
        _grantRole(BURNER_ROLE, initialOwner);
        _mint(initialOwner, 1000000 * 10 ** decimals());
    }

    
    function openTrading() external onlyOwner {
        tradingOpen = true;
    }

    function excludeFromFees(address account, bool excluded) external onlyOwner {
        _isExcludedFromFees[account] = excluded;
    }
  

    
    function setTaxes(uint256 _buyTax, uint256 _sellTax) external onlyOwner {
        require(_buyTax <= 25 && _sellTax <= 25, "Taxes cannot exceed 25%");
        buyTax = _buyTax;
        sellTax = _sellTax;
    }

    function setMarketingWallet(address _marketingWallet) external onlyOwner {
        require(_marketingWallet != address(0), "Marketing wallet cannot be zero address");
        marketingWallet = _marketingWallet;
    }
    

    
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
    

    
    function mint(address to, uint256 amount) public onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    
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
                fees = amount * sellTax / 100;
            } else if (automatedMarketMakerPairs[from]) {
                // Buy transfer
                fees = amount * buyTax / 100;
            }
            
            if (fees > 0) {
                super._transfer(from, address(this), fees);
                amount = amount - fees;
            }
        }

        // Transfer the remaining amount
        super._transfer(from, to, amount);
    }
}