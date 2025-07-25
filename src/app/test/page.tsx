"use client";
import { useState } from "react";
import { ethers } from "ethers";

export default function Test() {
  const [tokenAddress, setTokenAddress] = useState("");
  const [amountToken, setAmountToken] = useState("");
  const [amountMatic, setAmountMatic] = useState("");
  const [amountMaticSwap, setAmountMaticSwap] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [status, setStatus] = useState("");

  // Your deployed LiquidityAndBuy contract address
  const contractAddress = "0x2b3DD49409Be9e7923aaD360208A23477539d874";
  const routerAddress = "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff"; // Polygon

  const contractAbi = [
    "function addLiquidityAndBuy(address token,uint amountTokenDesired,uint amountTokenMin,uint amountETHMin,uint amountETHToSwap,uint amountOutMin,address to,uint deadline) external payable",
  ];

  const handleSubmit = async () => {
    try {
      setStatus("Processing transaction...");

      // Connect wallet via private key
      const provider = new ethers.JsonRpcProvider("https://polygon-rpc.com");
      const wallet = new ethers.Wallet(privateKey, provider);
      const contract = new ethers.Contract(contractAddress, contractAbi, wallet);

      const tokenAmount = ethers.parseUnits(amountToken, 18);
      const maticAmount = ethers.parseEther(amountMatic);
      const maticSwapAmount = ethers.parseEther(amountMaticSwap);

      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

      // Approve token transfer (token must be approved for contract)
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ["function approve(address spender,uint256 amount) public returns (bool)"],
        wallet
      );

      const approveTx = await tokenContract.approve(contractAddress, tokenAmount);
      await approveTx.wait();

      // Call the addLiquidityAndBuy method
      const tx = await contract.addLiquidityAndBuy(
        tokenAddress,
        tokenAmount,
        0, // amountTokenMin
        0, // amountETHMin
        maticSwapAmount,
        0, // amountOutMin
        wallet.address,
        deadline,
        { value: maticAmount }
      );

      await tx.wait();
      setStatus("Transaction successful!");
    } catch (err: any) {
      console.error(err);
      setStatus("Error: " + err.message);
    }
  };

  return (
    <div className="p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-4">Add Liquidity + Swap</h1>
      <input
        className="border p-2 w-full mb-2"
        placeholder="Token Address"
        value={tokenAddress}
        onChange={(e) => setTokenAddress(e.target.value)}
      />
      <input
        className="border p-2 w-full mb-2"
        placeholder="Amount of Tokens"
        value={amountToken}
        onChange={(e) => setAmountToken(e.target.value)}
      />
      <input
        className="border p-2 w-full mb-2"
        placeholder="Amount of MATIC for Liquidity"
        value={amountMatic}
        onChange={(e) => setAmountMatic(e.target.value)}
      />
      <input
        className="border p-2 w-full mb-2"
        placeholder="Amount of MATIC to Swap"
        value={amountMaticSwap}
        onChange={(e) => setAmountMaticSwap(e.target.value)}
      />
      <input
        className="border p-2 w-full mb-4"
        placeholder="Private Key"
        type="password"
        value={privateKey}
        onChange={(e) => setPrivateKey(e.target.value)}
      />
      <button
        onClick={handleSubmit}
        className="bg-blue-600 text-white px-4 py-2 rounded"
      >
        Submit
      </button>
      {status && <p className="mt-4">{status}</p>}
    </div>
  );
}
