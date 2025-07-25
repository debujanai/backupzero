// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC20FlashMint} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20FlashMint.sol";

contract PLEASE is ERC20, Ownable, ERC20Burnable, ERC20Pausable, AccessControl, ERC20FlashMint {
        bool public tradingOpen = false;
    mapping(address => bool) private _isExcludedFromFees;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    
    constructor(address initialOwner)
        ERC20("PLEASE", "WORK")
        Ownable()
        AccessControl()
    {
        
        _transferOwnership(initialOwner);
                _isExcludedFromFees[initialOwner] = true;
        
        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        _grantRole(MINTER_ROLE, initialOwner);
        _grantRole(PAUSER_ROLE, initialOwner);
        _grantRole(BURNER_ROLE, initialOwner);
        _mint(initialOwner, 100000 * 10 ** decimals());
    }

    
    function openTrading() external onlyOwner {
        tradingOpen = true;
    }

    function excludeFromFees(address account, bool excluded) external onlyOwner {
        _isExcludedFromFees[account] = excluded;
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

    
    function _beforeTokenTransfer(address from, address to, uint256 amount) internal override(ERC20, ERC20Pausable) {
        super._beforeTokenTransfer(from, to, amount);
        if (!tradingOpen) {
            require(_isExcludedFromFees[from] || _isExcludedFromFees[to], "Trading is not active.");
        }
    }
}