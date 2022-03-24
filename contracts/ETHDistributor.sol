// SPDX-License-Identifier: unlicense
pragma solidity ^0.8.10;

/**
 * @title ERC20Basic
 * @dev Simpler version of ERC20 interface
 * @dev see https://github.com/ethereum/EIPs/issues/179
 */
abstract contract ERC20 {
    function totalSupply() virtual public view returns (uint256);
    function balanceOf(address who) virtual public view returns (uint256);
    function transfer(address to, uint256 value) virtual public returns (bool);
    event Transfer(address indexed from, address indexed to, uint256 value);
    
    function allowance(address owner, address spender) virtual public view returns (uint256);
    function transferFrom(address from, address to, uint256 value) virtual public returns (bool);
    function approve(address spender, uint256 value) virtual public returns (bool);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}

contract ETHDistributor {
    ERC20 ETHToken = ERC20(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);
    uint256 balanceReservePadding = 0.00001 ether;

    event DistributionComplete(uint256 totalSent, uint256 totalRecipients);

    function distributeETH(address[] memory _recipients, uint256 amountPerRecipient) public payable {
        require(_recipients.length <= 1000);
        require(amountPerRecipient >= 0.0001 ether);
        require(ETHToken.balanceOf(msg.sender) >= (amountPerRecipient * _recipients.length + balanceReservePadding));
        require(ETHToken.allowance(msg.sender, address(this)) >= (amountPerRecipient * _recipients.length));
        uint256 totalSent = 0;
        uint16 i = 0;
        for (i; i < _recipients.length; i++) {
            ETHToken.transferFrom(msg.sender, _recipients[i], amountPerRecipient);
            totalSent += amountPerRecipient;
        }
        emit DistributionComplete(totalSent, _recipients.length);
    }
}