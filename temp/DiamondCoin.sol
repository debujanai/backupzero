// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


contract DiamondCoin is ERC20 {
    
    
    constructor(address initialOwner) ERC20("DiamondCoin", "DIAM")  {
        
        _mint(initialOwner, 100000 * 10 ** decimals());
    }
    
    
}