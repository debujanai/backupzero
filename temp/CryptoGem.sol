// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

// Uniswap Router interface for swapping tokens
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


interface IUniswapV2Factory {
    function createPair(address tokenA, address tokenB) external returns (address pair);
}

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC20FlashMint} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20FlashMint.sol";

contract CryptoGem is ERC20, Ownable, ERC20Burnable, ERC20Pausable, AccessControl, ERC20FlashMint {
        bool public tradingOpen = false;
    mapping(address => bool) private _isExcludedFromFees;
    uint256 public BuyFee = 2;
    uint256 public SellFee = 3;
    address private marketingWallet;
    bool private swapping;
    IUniswapV2Router02 public immutable uniswapV2Router;
    address public immutable uniswapV2Pair;
    using SafeMath for uint256;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    
    constructor(address initialOwner)
        ERC20("CryptoGem", "CGM")
        Ownable()
        AccessControl()
    {
        
        _transferOwnership(initialOwner);
        
        // Initialize Uniswap router and create pair
        uniswapV2Router = IUniswapV2Router02(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D); // Uniswap V2 Router
        uniswapV2Pair = IUniswapV2Factory(uniswapV2Router.factory()).createPair(address(this), uniswapV2Router.WETH());
        _isExcludedFromFees[address(uniswapV2Router)] = true;
                _isExcludedFromFees[initialOwner] = true;
                marketingWallet = initialOwner;
        
        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        _grantRole(MINTER_ROLE, initialOwner);
        _grantRole(PAUSER_ROLE, initialOwner);
        _grantRole(BURNER_ROLE, initialOwner);
        _mint(initialOwner, 850927955 * 10 ** decimals());
    }

    
    function swapTokensForEth(uint256 tokenAmount) private {
        if (tokenAmount == 0) {
            return;
        }
        
        // Generate the Uniswap pair path of token -> WETH
        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = uniswapV2Router.WETH();

        // Approve the router to spend tokens
        _approve(address(this), address(uniswapV2Router), tokenAmount);

        // Make the swap
        try uniswapV2Router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            tokenAmount,
            0, // Accept any amount of ETH
            path,
            marketingWallet, // Send ETH directly to marketing wallet
            block.timestamp + 300 // 5 minute deadline
        ) {} catch {
            // If swap fails, do nothing
        }
    }
    
    // Function to manually swap accumulated tokens for ETH
    function swapAccumulatedTokens() external onlyOwner {
        uint256 contractTokenBalance = balanceOf(address(this));
        if (contractTokenBalance > 0) {
            swapping = true;
            swapTokensForEth(contractTokenBalance);
            swapping = false;
        }
    }
    
    // To receive ETH from uniswapV2Router when swapping
    receive() external payable {}
    

    
    function openTrading() external onlyOwner {
        tradingOpen = true;
    }

    function excludeFromFees(address account, bool excluded) external onlyOwner {
        _isExcludedFromFees[account] = excluded;
    }
    
    function isExcludedFromFees(address account) public view returns (bool) {
        return _isExcludedFromFees[account];
    }
    
    function SetFees(uint256 _buyFee, uint256 _sellFee) external onlyOwner {
        require(_buyFee <= 40 && _sellFee <= 90, "Fees cannot exceed 90%");
        BuyFee = _buyFee;
        SellFee = _sellFee;
    }
    
    function setMarketingWallet(address _marketingWallet) external onlyOwner {
        require(_marketingWallet != address(0), "Marketing wallet cannot be zero address");
        marketingWallet = _marketingWallet;
    }
  

    
    function mint(address to, uint256 amount) public onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    
    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() public onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    
    function _transfer(address from, address to, uint256 amount) internal override {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");
        
        if (amount == 0) {
            super._transfer(from, to, 0);
            return;
        }
        
        // Check if trading is open - this is now handled in _beforeTokenTransfer
        
        // Determine if we need to take fee
        bool takeFee = !swapping && !_isExcludedFromFees[from] && !_isExcludedFromFees[to];
        
        // Calculate fees
        uint256 fees = 0;
        if (takeFee) {
            // Determine if it's a buy or sell
            if (to == uniswapV2Pair) { // Sell
                fees = amount.mul(SellFee).div(100);
            } else if (from == uniswapV2Pair) { // Buy
                fees = amount.mul(BuyFee).div(100);
            }
            
            if (fees > 0) {
                // Transfer fees to contract
                super._transfer(from, address(this), fees);
                
                // Transfer remaining amount
                amount = amount.sub(fees);
            }
        }
        
        // Transfer the remaining amount
        super._transfer(from, to, amount);
    }

    
    function _beforeTokenTransfer(address from, address to, uint256 amount) internal override(ERC20, ERC20Pausable) {
        super._beforeTokenTransfer(from, to, amount);
        if (!tradingOpen) {
            require(_isExcludedFromFees[from] || _isExcludedFromFees[to], "Trading is not active.");
        }
    }
}