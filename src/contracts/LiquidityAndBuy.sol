// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract LiquidityAndBuy {
    IUniswapV2Router02 public router;

    constructor(address _router) {
        require(_router != address(0), "Router address cannot be zero");
        router = IUniswapV2Router02(_router);
    }

    function addLiquidityAndBuy(
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountETHMin,
        uint amountETHToSwap,
        uint amountOutMin,
        address to,
        uint deadline
    ) external payable {
        require(msg.value > 0, "No ETH sent");
        require(amountETHToSwap <= msg.value, "Swap ETH exceeds total ETH");
        require(token != address(0), "Token address cannot be zero");

        // Transfer tokens to contract
        bool success = IERC20(token).transferFrom(msg.sender, address(this), amountTokenDesired);
        require(success, "Token transferFrom failed");

        // Approve router to spend tokens
        IERC20(token).approve(address(router), amountTokenDesired);

        uint liquidityETH = msg.value - amountETHToSwap;

        if (liquidityETH > 0) {
            router.addLiquidityETH{value: liquidityETH}(
                token,
                amountTokenDesired,
                amountTokenMin,
                amountETHMin,
                msg.sender,
                deadline
            );
        }

        if (amountETHToSwap > 0) {
            address ;
            path[0] = router.WETH();
            path[1] = token;

            router.swapExactETHForTokens{value: amountETHToSwap}(
                amountOutMin,
                path,
                to,
                deadline
            );
        }
    }

    receive() external payable {}
}
