// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

contract Testiing is ERC20, Ownable, ERC20Burnable {
    
    
    constructor(address initialOwner)
        ERC20("Testiing", "ToK")
        Ownable()
    {
        
        _transferOwnership(initialOwner);
        _mint(initialOwner, 1000000.0 * 10 ** decimals());
    }

    
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    
}