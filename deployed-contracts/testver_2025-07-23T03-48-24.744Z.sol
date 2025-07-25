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

contract testver is ERC20, Ownable {
        bool public tradingOpen = false;
    mapping(address => bool) private _isExcludedFromFees;
    event ExcludeFromFees(address indexed account, bool isExcluded);
    uint256 public BuyFee = 5;
    uint256 public SellFee = 1;
    address public marketingWallet;
    address private deployerWallet;
    IUniswapV2Router02 public uniswapV2Router;
    address public uniswapV2Pair;
    bool private swapping;
    mapping(address => bool) private automatedMarketMakerPairs;
    uint256 public swapTokensAtAmount;
    uint256 public maxTransactionAmount;
    uint256 public maxWallet;
    event SetAutomatedMarketMakerPair(address indexed pair, bool indexed value);
    
    constructor(address initialOwner)
        ERC20("testver", "test")
        Ownable()
    {
        
        _transferOwnership(initialOwner);
                _isExcludedFromFees[initialOwner] = true;
        
        marketingWallet = initialOwner;
        deployerWallet = initialOwner;
        uniswapV2Router = IUniswapV2Router02(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D); // Uniswap V2 Router

        // Initialize limits as percentage of supply
        uint256 totalSupplyValue = 771706627 * 10 ** decimals();
        maxTransactionAmount = totalSupplyValue * 1 / 100; // 1% of supply
        maxWallet = totalSupplyValue * 1 / 100; // 1% of supply
        swapTokensAtAmount = totalSupplyValue * 1 / 100; // 1% of supply
        _mint(initialOwner, 771706627 * 10 ** decimals());
    }

    
    function openTrading() external onlyOwner {
        tradingOpen = true;
    }

    function excludeFromFees(address account, bool excluded) external onlyOwner {
        _isExcludedFromFees[account] = excluded;
        emit ExcludeFromFees(account, excluded);
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
    
    function clearStuckTheEth() external {
        require(_msgSender() == deployerWallet);
        require(address(this).balance > 0, "Token: no ETH to clear");
        payable(msg.sender).transfer(address(this).balance);
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
    }
}